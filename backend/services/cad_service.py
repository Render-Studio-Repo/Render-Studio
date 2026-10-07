"""CAD mesh operations: load, export, and build primitives from AI actions."""

from __future__ import annotations

import contextvars
import copy
import hashlib
import json
import logging
import math
import os
import re
import shutil
import struct
import threading
import time
import uuid
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Sequence, Optional
from xml.etree import ElementTree as ET

import numpy as np
import trimesh

logger = logging.getLogger(__name__)

# Optional editable STEP sibling for mesh boolean fallback (face-pull / hole cut).
_BOOLEAN_BREP_BASE: contextvars.ContextVar[Path | None] = contextvars.ContextVar(
    "boolean_brep_base", default=None
)

# Cross-process lock + in-flight set so lazy/upload STEP→GLB never blocks HTTP workers.
_PREVIEW_GLB_GUARD = threading.Lock()
_PREVIEW_GLB_THREADS: dict[str, threading.Thread] = {}
_PREVIEW_CACHE_DIRNAME = ".preview-glb-cache"

THREEMF_CORE_NS = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
THREEMF_PRODUCTION_NS = "http://schemas.microsoft.com/3dmanufacturing/production/2015/06"
THREEMF_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
THREEMF_CONTENT_TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
THREEMF_MODEL_REL_TYPE = "http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"
THREEMF_BAMBU_NS = "http://schemas.bambulab.com/package/2021"
THREEMF_IDENTITY_TRANSFORM = "1 0 0 0 1 0 0 0 1 0 0 0"
# Bambu Studio plate grid (X1/P1 default bed) — matches PartPlate LOGICAL_PART_PLATE_GAP=1/5
THREEMF_BAMBU_BED_W = 256.0
THREEMF_BAMBU_BED_D = 256.0
THREEMF_BAMBU_EDGE_MARGIN = 10.0
# X1/P1 nozzle-wipe exclusion rectangle from Bambu Studio's machine profiles.
# Arrange.cpp adds another 1 mm gap around machine exclusion regions.
THREEMF_BAMBU_EXCLUDE_RECT = (0.0, 0.0, 18.0, 28.0)
THREEMF_BAMBU_EXCLUDE_GAP = 1.0
THREEMF_BAMBU_PLATE_GAP = 1.0 / 5.0
THREEMF_BAMBU_MAX_PLATES = 36
# Studio only treats the file as a multi-plate *project* when Application starts with
# "BambuStudio-" AND Metadata/project_settings.config is present. Otherwise it dumps
# every object onto plate 01 with world transforms (looks like black plate meshes).
THREEMF_BAMBU_APPLICATION = "BambuStudio-01.10.00.87"
THREEMF_BAMBU_OBJECT_UUID_SUFFIX = "-61cb-4c03-9d28-80fed5dfa1dc"
THREEMF_BAMBU_SUBOBJECT_UUID_SUFFIX = "-81cb-4c03-9d28-80fed5dfa1dc"
THREEMF_BAMBU_COMPONENT_UUID_SUFFIX = "-b206-40ff-9872-83e8017abed1"
THREEMF_BAMBU_BUILD_ITEM_UUID_SUFFIX = "-b1ec-4553-aec9-835e5b724bb4"
THREEMF_BAMBU_BUILD_UUID = "2c7c17d8-22b5-4d84-8835-1976022ea369"
_BAMBU_PROJECT_SETTINGS_PATH = Path(__file__).resolve().parent / "bambu_project_settings_x1c.json"
ET.register_namespace("", THREEMF_CORE_NS)
ET.register_namespace("p", THREEMF_PRODUCTION_NS)
ET.register_namespace("BambuStudio", THREEMF_BAMBU_NS)


@dataclass(frozen=True)
class _SlicerPartPlacement:
    plate_index: int
    center_xy: tuple[float, float]
    rotation_deg: tuple[float, float, float]

_3MF_CONTENT_TYPES_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>
"""

_3MF_BAMBU_CONTENT_TYPES_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="config" ContentType="application/octet-stream"/>
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
STEP_SUFFIX_VARIANTS = (".step", ".stp", ".STEP", ".STP")
IGES_SUFFIXES = {".iges", ".igs"}
BREP_SUFFIXES = {".brep", ".brp"}
MESH_VIEW_SUFFIXES = {".stl", ".obj", ".glb", ".gltf", ".ply", ".off", ".3mf"}
PROPRIETARY_CAD_SUFFIXES = {".f3d", ".sldprt", ".sldasm", ".x_t", ".x_b", ".sat", ".sab"}
ARCHIVE_CAD_SUFFIXES = {".f3z", ".zip", ".f3d"}
SUPPORTED_EXPORT = {".stl", ".glb", ".obj", ".3mf", ".step"}
# Robot description artifacts (listed in the project browser / file list, not timeline meshes).
SUPPORTED_ROBOT = {".urdf", ".srdf"}
# Sidecars written on export (not during generate). Faceted STEP is internal-only.
MESH_DERIVED_EXPORTS = ("stl", "3mf", "obj", "step")
ON_DEMAND_MESH_EXPORTS = ("stl", "3mf", "obj")
_DERIVED_MESH_SOURCE_SUFFIXES = (".glb", ".gltf", ".stl", ".obj", ".ply", ".off")
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
    ".js",
    ".mjs",
    ".cjs",
    ".jsx",
    ".ts",
    ".tsx",
    ".py",
    ".css",
    ".scss",
    ".less",
    ".sh",
    ".bash",
    ".zsh",
    ".ino",
    ".c",
    ".cc",
    ".cpp",
    ".cxx",
    ".h",
    ".hpp",
    ".java",
    ".go",
    ".rs",
    ".rb",
    ".php",
    ".sql",
    ".toml",
    ".ini",
    ".cfg",
    ".xml",
    ".jsonc",
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
    ".webm",
    ".mp4",
    ".mov",
    ".m4v",
    ".mp3",
    ".wav",
    ".m4a",
    ".aac",
    ".ogg",
    ".opus",
    ".flac",
    ".aiff",
    ".aif",
    ".wma",
    ".weba",
}
REFERENCE_TEXT_SUFFIXES = {
    ".txt", ".md", ".csv", ".tsv", ".log", ".json", ".jsonc", ".yaml", ".yml", ".html", ".htm", ".rtf",
    ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".py", ".css", ".scss", ".less", ".sh", ".bash", ".zsh",
    ".ino", ".c", ".cc", ".cpp", ".cxx", ".h", ".hpp", ".java", ".go", ".rs", ".rb", ".php", ".sql",
    ".toml", ".ini", ".cfg", ".xml",
}
REFERENCE_IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg", ".tif", ".tiff"}
REFERENCE_VIDEO_SUFFIXES = {".webm", ".mp4", ".mov", ".m4v"}
REFERENCE_AUDIO_SUFFIXES = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".flac", ".aiff", ".aif", ".wma", ".weba"}
REFERENCE_DIRNAME = "references"
RENDERS_DIRNAME = "renders"
IMAGINE_DIRNAME = "imagine"
IMAGINE_FETCHED_DIRNAME = "fetched"
# Nested folder under references/ for Quest / WebXR POV screenshots + clips.
REFERENCE_AR_DIRNAME = "AR"
REFERENCE_RECORDINGS_DIRNAME = "recordings"  # legacy on-disk name
REFERENCE_SCREEN_RECORDINGS_DIRNAME = "Screen Recordings"
REFERENCE_SCREENSHOTS_DIRNAME = "Screenshots"
REFERENCE_MCMASTER_DIRNAME = "McMaster"
MCMASTER_LIBRARY_DIRNAME = "mcmaster_library"
MARKUP_FOLDER_NAMES = frozenset({REFERENCE_DIRNAME, RENDERS_DIRNAME, IMAGINE_DIRNAME})
# Allowed one-level subfolders inside references/ (basename only).
REFERENCE_IMPROVE_LAB_DIRNAME = "Improve Lab"
REFERENCE_ELECTRONICS_DIRNAME = "Electronics wiring"
REFERENCE_IMAGES_DIRNAME = "Images"
REFERENCE_VIDEOS_DIRNAME = "Videos"
REFERENCE_DOCUMENTS_DIRNAME = "Documents"
REFERENCE_CANVAS_DIRNAME = "Canvas"
REFERENCE_VIDEO_EDITOR_DIRNAME = "Video Editor"
REFERENCE_CODE_DIRNAME = "Project Code"
REFERENCE_SUBFOLDERS = frozenset(
    {
        REFERENCE_AR_DIRNAME,
        REFERENCE_RECORDINGS_DIRNAME,
        REFERENCE_SCREEN_RECORDINGS_DIRNAME,
        REFERENCE_SCREENSHOTS_DIRNAME,
        REFERENCE_MCMASTER_DIRNAME,
        REFERENCE_IMPROVE_LAB_DIRNAME,
        REFERENCE_ELECTRONICS_DIRNAME,
        REFERENCE_IMAGES_DIRNAME,
        REFERENCE_VIDEOS_DIRNAME,
        REFERENCE_DOCUMENTS_DIRNAME,
        REFERENCE_CANVAS_DIRNAME,
        REFERENCE_VIDEO_EDITOR_DIRNAME,
        REFERENCE_CODE_DIRNAME,
    }
)
_REFERENCE_FOLDER_ALIASES = {
    "recordings": REFERENCE_SCREEN_RECORDINGS_DIRNAME,
    "screen recordings": REFERENCE_SCREEN_RECORDINGS_DIRNAME,
    "screen-recordings": REFERENCE_SCREEN_RECORDINGS_DIRNAME,
    "screenshots": REFERENCE_SCREENSHOTS_DIRNAME,
    "screenshot": REFERENCE_SCREENSHOTS_DIRNAME,
    "ar": REFERENCE_AR_DIRNAME,
    "mcmaster": REFERENCE_MCMASTER_DIRNAME,
    "electronics": REFERENCE_ELECTRONICS_DIRNAME,
    "electronics wiring": REFERENCE_ELECTRONICS_DIRNAME,
    "electronics-wiring": REFERENCE_ELECTRONICS_DIRNAME,
    "images": REFERENCE_IMAGES_DIRNAME,
    "image renders": REFERENCE_IMAGES_DIRNAME,
    "videos": REFERENCE_VIDEOS_DIRNAME,
    "documents": REFERENCE_DOCUMENTS_DIRNAME,
    "canvas": REFERENCE_CANVAS_DIRNAME,
    "video editor": REFERENCE_VIDEO_EDITOR_DIRNAME,
    "video-editor": REFERENCE_VIDEO_EDITOR_DIRNAME,
    "clip editor": REFERENCE_VIDEO_EDITOR_DIRNAME,
    "clip-editor": REFERENCE_VIDEO_EDITOR_DIRNAME,
    "project code": REFERENCE_CODE_DIRNAME,
    "project-code": REFERENCE_CODE_DIRNAME,
    "code": REFERENCE_CODE_DIRNAME,
}
MCMASTER_PARTS_LIST_FILENAME = "parts_list.md"

def _hex_to_rgba_u8(hex_color: str, alpha: int = 255) -> list[int]:
    text = str(hex_color).strip().lstrip("#")
    if len(text) == 3:
        text = "".join(ch * 2 for ch in text)
    return [int(text[0:2], 16), int(text[2:4], 16), int(text[4:6], 16), int(alpha)]


# CAD Viewer default theme fills (`cadgen-js` WORKBENCH_FILL_COLORS). Cycle by
# part index instead of inventing random industrial hexes.
WORKBENCH_FILL_HEX = (
    "#b6c4ce",
    "#f4a7a7",
    "#f8c77e",
    "#f7e38d",
    "#b9e88f",
    "#8fe3c0",
    "#92d7f5",
    "#a9b8ff",
    "#c7a8ff",
    "#f2a7d9",
)
DEFAULT_APPEARANCE_PALETTE = np.array(
    [_hex_to_rgba_u8(hex_color) for hex_color in WORKBENCH_FILL_HEX],
    dtype=np.uint8,
)

# Realistic shop swatches for generated assemblies (not CAD Viewer pastels).
SHOP_FILL_HEX = (
    "#c0c6cc",  # aluminum / housing
    "#8a939d",  # steel
    "#3a3f44",  # black oxide
    "#c6d0da",  # stainless fasteners
    "#c4a574",  # brass
    "#d9d3c7",  # POM / nylon
    "#4a5560",  # rubber
    "#6b7c8a",  # dark aluminum
)
SHOP_APPEARANCE_PALETTE = np.array(
    [_hex_to_rgba_u8(h) for h in SHOP_FILL_HEX],
    dtype=np.uint8,
)
# Generated CAD hashes onto shop metals, not workbench salmon/mint fills.
INDUSTRIAL_APPEARANCE_PALETTE = SHOP_APPEARANCE_PALETTE
SHOP_ASSEMBLY_PART_PALETTE: list[tuple[float, float, float, float]] = [
    (float(row[0]) / 255.0, float(row[1]) / 255.0, float(row[2]) / 255.0, 1.0)
    for row in SHOP_APPEARANCE_PALETTE
]

# Keyword → part colour (mid/light tones so bodies stay visible on dark canvas).
_SEMANTIC_PART_COLOR_RULES: list[tuple[tuple[str, ...], list[int]]] = [
    (("chess", "pawn", "rook", "knight", "bishop", "queen", "king", "staunton", "ivory"), [232, 224, 212, 255]),
    (("ebony", "black piece", "dark piece"), [42, 42, 46, 255]),
    (("pcb", "circuit board", "arduino", "raspberry"), [46, 148, 78, 255]),
    (("rubber", "tpu", "gasket", "o-ring", "oring", "o ring", "tire", "tyre", "bumper"), [109, 122, 140, 255]),
    (("glass", "lens", "window", "acrylic", "perspex", "transparent"), [176, 212, 232, 220]),
    (("bolt", "screw", "nut", "washer", "fastener", "rivet", "dowel pin", "clevis"), [196, 206, 218, 255]),
    (("bearing", "bushing", "race"), [200, 210, 222, 255]),
    (("gear", "sprocket", "pulley", "rack"), [120, 158, 196, 255]),
    (("motor", "servo", "nema", "actuator", "stepper"), [110, 138, 168, 255]),
    (("wire", "cable", "harness", "loom"), [148, 118, 196, 255]),
    (("aluminum", "aluminium", "al6061", "extrusion", "2020", "4040"), [168, 196, 220, 255]),
    (("steel", "stainless", "inox", "sheet metal"), [198, 208, 218, 255]),
    (("copper", "brass", "bronze"), [214, 154, 86, 255]),
    (("wood", "oak", "pine", "plywood", "mdf"), [196, 154, 98, 255]),
    (("housing", "enclosure", "case", "shell", "cover", "lid", "chassis"), [182, 196, 206, 255]),
    (("plastic", "abs", "pla", "petg", "nylon"), [182, 196, 206, 255]),
    (("wheel", "roller", "caster"), [130, 144, 164, 255]),
    (("battery", "cell pack"), [72, 168, 118, 255]),
    (("led", "lamp", "bulb", "light"), [248, 244, 210, 255]),
    (("food", "bowl", "plate", "utensil", "whisk", "spatula"), [240, 232, 214, 255]),
    (("openarm",), [182, 196, 206, 255]),
    (("robot", "arm", "link", "joint", "gripper"), [120, 174, 232, 255]),
    (("bracket", "mount", "clamp", "plate", "flange"), [168, 196, 220, 255]),
    (("spring", "coil"), [210, 216, 196, 255]),
    (("magnet", "neodymium"), [118, 132, 168, 255]),
    (("carbon", "cfrp"), [108, 124, 148, 255]),
    (("concrete", "stone", "ceramic"), [186, 178, 166, 255]),
    (("fabric", "cloth", "textile"), [168, 140, 124, 255]),
]


def project_dir(base: Path, project_id: str) -> Path:
    path = base / project_id
    try:
        from backend.services.project_lifecycle import is_project_deleted

        if is_project_deleted(project_id):
            return path
    except Exception:
        pass
    path.mkdir(parents=True, exist_ok=True)
    return path


def sanitize_canvas_store_name(name: str | None) -> str:
    """Safe display name for ``references/Canvas/<name>/`` (spaces allowed)."""
    raw = str(name or "").strip()
    cleaned = re.sub(r"[^\w\s\-_.]", "", raw, flags=re.UNICODE)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return (cleaned or "Canvas")[:80]


def canvas_folder_key(name: str | None) -> str:
    return f"{REFERENCE_CANVAS_DIRNAME}/{sanitize_canvas_store_name(name)}"


def sanitize_video_editor_store_name(name: str | None) -> str:
    """Safe nested Video Editor project name (spaces allowed)."""
    raw = str(name or "").strip()
    cleaned = re.sub(r"[^\w\s\-_.]", "", raw, flags=re.UNICODE)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return (cleaned or REFERENCE_VIDEO_EDITOR_DIRNAME)[:80]


def video_editor_folder_key(name: str | None) -> str:
    return f"{REFERENCE_VIDEO_EDITOR_DIRNAME}/{sanitize_video_editor_store_name(name)}"


def sanitize_code_store_name(name: str | None) -> str:
    raw = str(name or "").strip()
    cleaned = re.sub(r"[^\w\s\-_.]", "", raw, flags=re.UNICODE)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return (cleaned or "Uploaded code")[:80]


def code_folder_key(name: str | None) -> str:
    raw = str(name or "").strip().strip("/\\").replace("\\", "/")
    parts = [p for p in raw.split("/") if p and p not in {".", ".."}]
    if parts and parts[0].lower() in {"project code", "project-code", "code"}:
        parts = parts[1:]
    safe = [sanitize_code_store_name(part) for p in parts for part in [p] if sanitize_code_store_name(part)]
    return "/".join([REFERENCE_CODE_DIRNAME, *safe]) if safe else REFERENCE_CODE_DIRNAME


def canonical_reference_folder(name: str | None) -> str | None:
    """Map aliases like ``recordings`` to the live folder name used for new files.

    Nested Canvas stores use ``Canvas/<name>``.
    """
    raw = str(name or "").strip().strip("/\\").replace("\\", "/")
    if not raw:
        return None
    mapped = _REFERENCE_FOLDER_ALIASES.get(raw.lower())
    if mapped:
        return mapped
    if raw in REFERENCE_SUBFOLDERS:
        return raw
    parts = [p for p in raw.split("/") if p and p not in {".", ".."}]
    if len(parts) >= 2:
        top = _REFERENCE_FOLDER_ALIASES.get(parts[0].lower())
        if not top and parts[0] in REFERENCE_SUBFOLDERS:
            top = parts[0]
        if top == REFERENCE_CANVAS_DIRNAME:
            return canvas_folder_key("/".join(parts[1:]))
        if top == REFERENCE_VIDEO_EDITOR_DIRNAME:
            return video_editor_folder_key("/".join(parts[1:]))
        if top == REFERENCE_CODE_DIRNAME:
            return code_folder_key("/".join(parts))
    return None


def reference_rel_folder(project_path: Path, dest: Path) -> str | None:
    """Folder key relative to ``references/`` (e.g. ``Canvas/My board``)."""
    try:
        rel = Path(dest).resolve().parent.relative_to(references_dir(project_path).resolve())
    except ValueError:
        return None
    if not rel.parts:
        return None
    return "/".join(rel.parts)


def infer_reference_suffix(filename: str, content_type: str | None = None) -> str:
    """Pick a reference extension from a filename or MIME type."""
    suffix = Path(filename or "").suffix.lower()
    if suffix in SUPPORTED_REFERENCE:
        return suffix
    ct = str(content_type or "").lower()
    if "png" in ct:
        return ".png"
    if "jpeg" in ct or ct.endswith("/jpg"):
        return ".jpg"
    if "webp" in ct:
        return ".webp"
    if "mp4" in ct or "m4v" in ct:
        return ".mp4"
    if "quicktime" in ct:
        return ".mov"
    if "webm" in ct or ct.startswith("video/"):
        return ".webm"
    if "mpeg" in ct or "mp3" in ct:
        return ".mp3"
    if "wav" in ct:
        return ".wav"
    if "flac" in ct:
        return ".flac"
    if ct.startswith("audio/"):
        return ".mp3"
    return suffix


def capture_reference_folder(kind: str | None = None, folder: str | None = None) -> str:
    """Folder for a viewport capture: Screen Recordings or Screenshots."""
    mapped = canonical_reference_folder(folder)
    if str(folder or "").strip() and not mapped:
        raise ValueError(f"Unknown reference folder: {Path(str(folder)).name}")
    if mapped:
        return mapped
    kind_l = str(kind or "").strip().lower()
    if kind_l in {"screenshot", "screenshots", "image", "png", "jpeg", "jpg"}:
        return REFERENCE_SCREENSHOTS_DIRNAME
    if kind_l in {"video-editor", "clip-editor", "edited-video", "editor-video"}:
        return REFERENCE_VIDEO_EDITOR_DIRNAME
    return REFERENCE_SCREEN_RECORDINGS_DIRNAME


def write_reference_capture(
    project_path: Path,
    filename: str,
    *,
    folder: str,
    source: Any,
    overwrite: bool = False,
) -> Path:
    """Stream a capture blob into ``references/<folder>/`` without loading it all in RAM."""
    if overwrite:
        dest_dir = reference_subdir(project_path, folder)
        safe = Path(filename).name or "reference.bin"
        dest = dest_dir / safe
    else:
        dest = unique_reference_path(project_path, filename, folder=folder)
    with dest.open("wb") as out:
        if hasattr(source, "read"):
            shutil.copyfileobj(source, out)
        else:
            out.write(source)
    if not dest.is_file() or dest.stat().st_size <= 0:
        try:
            dest.unlink(missing_ok=True)
        except OSError:
            pass
        raise ValueError("Capture upload was empty.")
    return dest


def references_dir(project_path: Path) -> Path:
    path = Path(project_path) / REFERENCE_DIRNAME
    path.mkdir(parents=True, exist_ok=True)
    return path


def reference_subdir(project_path: Path, folder: str | None) -> Path:
    """Return references/ or an allowed nested folder like references/Screen Recordings/.

    The folder is created only when a file is being saved into it.
    """
    root = references_dir(project_path)
    name = str(folder or "").strip().strip("/\\")
    if not name:
        return root
    safe = canonical_reference_folder(name)
    if not safe:
        raise ValueError(f"Unknown reference folder: {Path(name).name}")
    path = root.joinpath(*safe.split("/"))
    path.mkdir(parents=True, exist_ok=True)
    return path


def canvas_store_dir(project_path: Path, name: str, *, create: bool = False) -> Path:
    path = references_dir(project_path) / REFERENCE_CANVAS_DIRNAME / sanitize_canvas_store_name(name)
    if create:
        path.mkdir(parents=True, exist_ok=True)
    return path


def write_canvas_board(project_path: Path, name: str, state: dict[str, Any] | None = None) -> Path:
    from datetime import datetime, timezone

    dest_dir = canvas_store_dir(project_path, name, create=True)
    dest = dest_dir / "canvas.json"
    payload = {
        "name": sanitize_canvas_store_name(name),
        "state": state if isinstance(state, dict) else {},
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    dest.write_text(json.dumps(payload), encoding="utf-8")
    return dest


def read_canvas_board(project_path: Path, name: str) -> dict[str, Any] | None:
    dest = canvas_store_dir(project_path, name, create=False) / "canvas.json"
    if not dest.is_file():
        return None
    try:
        data = json.loads(dest.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def list_canvas_boards(project_path: Path) -> list[dict[str, Any]]:
    root = references_dir(project_path) / REFERENCE_CANVAS_DIRNAME
    if not root.is_dir():
        return []
    out: list[dict[str, Any]] = []
    for child in root.iterdir():
        if not child.is_dir():
            continue
        board = child / "canvas.json"
        name = sanitize_canvas_store_name(child.name)
        mtime = 0.0
        if board.is_file():
            try:
                data = json.loads(board.read_text(encoding="utf-8"))
                if isinstance(data, dict) and data.get("name"):
                    name = sanitize_canvas_store_name(str(data.get("name")))
            except (OSError, json.JSONDecodeError):
                pass
            try:
                mtime = board.stat().st_mtime
            except OSError:
                mtime = 0.0
        else:
            try:
                mtime = child.stat().st_mtime
            except OSError:
                mtime = 0.0
        out.append({
            "name": name,
            "folder": canvas_folder_key(name),
            "mtime": mtime,
        })
    out.sort(key=lambda row: float(row.get("mtime") or 0), reverse=True)
    return out


def rename_canvas_store(project_path: Path, old_name: str, new_name: str) -> str:
    old_key = sanitize_canvas_store_name(old_name)
    new_key = sanitize_canvas_store_name(new_name)
    root = references_dir(project_path) / REFERENCE_CANVAS_DIRNAME
    src = root / old_key
    dest = root / new_key
    if old_key == new_key:
        return new_key
    dest.parent.mkdir(parents=True, exist_ok=True)
    if src.is_dir():
        if dest.exists() and dest.resolve() != src.resolve():
            raise ValueError("A canvas folder with that name already exists.")
        src.rename(dest)
    else:
        dest.mkdir(parents=True, exist_ok=True)
    board = dest / "canvas.json"
    if board.is_file():
        try:
            data = json.loads(board.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                data["name"] = new_key
                board.write_text(json.dumps(data), encoding="utf-8")
        except (OSError, json.JSONDecodeError):
            pass
    return new_key


def video_editor_store_dir(project_path: Path, name: str, *, create: bool = False) -> Path:
    path = references_dir(project_path) / REFERENCE_VIDEO_EDITOR_DIRNAME / sanitize_video_editor_store_name(name)
    if create:
        path.mkdir(parents=True, exist_ok=True)
    return path


VIDEO_EDITOR_META_FILENAME = "editor.json"
VIDEO_EDITOR_THUMB_FILENAME = "thumb.jpg"
VIDEO_EDITOR_MEDIA_EXTS = {
    ".mp4", ".webm", ".mov", ".m4v", ".ogg",
    ".png", ".jpg", ".jpeg", ".webp", ".gif",
    ".mp3", ".wav", ".m4a", ".aac", ".opus", ".flac", ".aiff", ".aif", ".wma", ".weba",
}
VIDEO_EDITOR_SKIP_FILES = {VIDEO_EDITOR_META_FILENAME, VIDEO_EDITOR_THUMB_FILENAME}


def unique_video_editor_store_name(project_path: Path, name: str | None) -> str:
    base = sanitize_video_editor_store_name(name)
    root = references_dir(project_path) / REFERENCE_VIDEO_EDITOR_DIRNAME
    if not (root / base).exists():
        return base
    for i in range(2, 80):
        candidate = f"{base} {i}"[:80]
        if not (root / candidate).exists():
            return candidate
    return f"{base} {int(time.time()) % 10000}"[:80]


def _video_editor_meta_path(project_path: Path, name: str) -> Path:
    return video_editor_store_dir(project_path, name, create=False) / VIDEO_EDITOR_META_FILENAME


def _read_video_editor_meta(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _normalize_video_editor(entry: dict[str, Any] | None) -> dict[str, str]:
    raw = entry if isinstance(entry, dict) else {}
    uid = str(raw.get("id") or raw.get("user_id") or "").strip()
    if not uid:
        return {}
    return {
        "id": uid,
        "display_name": str(raw.get("display_name") or raw.get("name") or raw.get("email") or "User").strip()[:80],
        "avatar_url": str(raw.get("avatar_url") or "").strip()[:400],
    }


def normalize_video_editor_source_ref(entry: Any) -> dict[str, str]:
    """Pointer to an existing project file. Never copies bytes."""
    if isinstance(entry, str):
        path = entry
        kind = ""
        name = ""
    elif isinstance(entry, dict):
        path = str(entry.get("path") or entry.get("source_path") or entry.get("filename") or "").strip()
        kind = str(entry.get("kind") or "").strip().lower()
        name = str(entry.get("name") or "").strip()
    else:
        return {}
    path = path.replace("\\", "/").lstrip("/")
    if path.startswith("references/"):
        path = path[len("references/") :]
    parts = [p for p in path.split("/") if p and p not in {".", ".."}]
    if not parts:
        return {}
    path = "/".join(parts)
    name = (name or parts[-1]).replace("\\", "/").split("/")[-1].strip()
    if not name:
        return {}
    suffix = Path(name).suffix.lower()
    if kind not in {"video", "audio", "image"}:
        if suffix in REFERENCE_AUDIO_SUFFIXES or suffix in {".ogg", ".opus", ".weba"}:
            kind = "audio"
        elif suffix in {".png", ".jpg", ".jpeg", ".webp", ".gif"}:
            kind = "image"
        else:
            kind = "video"
    return {"path": path, "name": name, "kind": kind}


def merge_video_editor_source_refs(*groups: Any) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for group in groups:
        if not group:
            continue
        rows = group if isinstance(group, list) else [group]
        for row in rows:
            ref = normalize_video_editor_source_ref(row)
            if not ref:
                continue
            key = ref["path"].lower()
            if key in seen:
                continue
            seen.add(key)
            out.append(ref)
    return out


def write_video_editor_project(
    project_path: Path,
    name: str,
    *,
    editor: dict[str, Any] | None = None,
    unique: bool = False,
    caption: str | None = None,
    timeline: dict[str, Any] | None = None,
    sources: list[Any] | None = None,
) -> dict[str, Any]:
    """Create or update a Video Editor folder so it appears in Reference Files immediately.

    ``sources`` are path references to existing recordings — they are not copied.
    """
    from datetime import datetime, timezone

    key = unique_video_editor_store_name(project_path, name) if unique else sanitize_video_editor_store_name(name)
    dest_dir = video_editor_store_dir(project_path, key, create=True)
    dest = dest_dir / VIDEO_EDITOR_META_FILENAME
    created = not dest.is_file()
    now = datetime.now(timezone.utc).isoformat()
    payload = _read_video_editor_meta(dest)
    editors: list[dict[str, str]] = []
    seen: set[str] = set()
    for row in payload.get("editors") or []:
        person = _normalize_video_editor(row)
        if person and person["id"] not in seen:
            seen.add(person["id"])
            editors.append(person)
    person = _normalize_video_editor(editor)
    if person and person["id"] not in seen:
        editors.append(person)
    saved_timeline = payload.get("timeline") if isinstance(payload.get("timeline"), dict) else {}
    next_timeline = timeline if isinstance(timeline, dict) else saved_timeline
    next_sources = merge_video_editor_source_refs(
        payload.get("sources"),
        sources if sources is not None else None,
    )
    next_payload = {
        "name": key,
        "created_at": str(payload.get("created_at") or now),
        "updated_at": now,
        "editors": editors,
        "caption": str(caption if caption is not None else payload.get("caption") or "")[:400],
        "thumb": str(payload.get("thumb") or ""),
        "timeline": next_timeline if isinstance(next_timeline, dict) else {},
        "sources": next_sources,
    }
    dest.write_text(json.dumps(next_payload), encoding="utf-8")
    row = video_editor_project_payload(project_path, key, next_payload)
    row["created"] = created
    return row


def video_editor_project_payload(project_path: Path, name: str, meta: dict[str, Any] | None = None) -> dict[str, Any]:
    key = sanitize_video_editor_store_name(name)
    dest_dir = video_editor_store_dir(project_path, key, create=False)
    payload = meta if isinstance(meta, dict) else _read_video_editor_meta(dest_dir / VIDEO_EDITOR_META_FILENAME)
    folder = video_editor_folder_key(key)
    files: list[dict[str, Any]] = []
    has_media = False
    seen_names: set[str] = set()
    if dest_dir.is_dir():
        for child in dest_dir.iterdir():
            if not child.is_file() or child.name in VIDEO_EDITOR_SKIP_FILES:
                continue
            suffix = child.suffix.lower()
            if suffix not in VIDEO_EDITOR_MEDIA_EXTS:
                continue
            has_media = True
            if suffix in REFERENCE_AUDIO_SUFFIXES or suffix in {".ogg", ".opus"}:
                kind = "audio"
            elif suffix in {".mp4", ".webm", ".mov", ".m4v"}:
                kind = "video"
            else:
                kind = "image"
            rel = f"{folder}/{child.name}".replace("\\", "/")
            files.append({"filename": rel, "name": child.name, "kind": kind})
            seen_names.add(child.name.lower())
    for ref in merge_video_editor_source_refs(payload.get("sources"), None):
        if ref["name"].lower() in seen_names:
            continue
        files.append({
            "filename": ref["path"],
            "name": ref["name"],
            "kind": ref["kind"],
            "path_ref": True,
            "source_path": ref["path"],
        })
        seen_names.add(ref["name"].lower())
        has_media = True
    files.sort(key=lambda row: str(row.get("name") or ""))
    thumb_name = VIDEO_EDITOR_THUMB_FILENAME if (dest_dir / VIDEO_EDITOR_THUMB_FILENAME).is_file() else str(payload.get("thumb") or "")
    thumb_rel = f"{folder}/{VIDEO_EDITOR_THUMB_FILENAME}" if (dest_dir / VIDEO_EDITOR_THUMB_FILENAME).is_file() else ""
    return {
        "name": key,
        "folder": folder,
        "created_at": payload.get("created_at") or "",
        "updated_at": payload.get("updated_at") or "",
        "editors": [
            person
            for person in (_normalize_video_editor(row) for row in (payload.get("editors") or []))
            if person
        ],
        "caption": str(payload.get("caption") or ""),
        "has_media": has_media,
        "sources": merge_video_editor_source_refs(payload.get("sources"), None),
        "files": files,
        "thumb": thumb_name,
        "thumb_rel": thumb_rel,
        "timeline": payload.get("timeline") if isinstance(payload.get("timeline"), dict) else {},
    }


def save_video_editor_thumb(project_path: Path, name: str, image_bytes: bytes) -> dict[str, Any]:
    dest_dir = video_editor_store_dir(project_path, name, create=True)
    dest = dest_dir / VIDEO_EDITOR_THUMB_FILENAME
    dest.write_bytes(image_bytes)
    meta = _read_video_editor_meta(dest_dir / VIDEO_EDITOR_META_FILENAME)
    meta["thumb"] = VIDEO_EDITOR_THUMB_FILENAME
    dest_dir.joinpath(VIDEO_EDITOR_META_FILENAME).write_text(json.dumps(meta or {"name": sanitize_video_editor_store_name(name)}), encoding="utf-8")
    return video_editor_project_payload(project_path, name)


def list_video_editor_projects(project_path: Path) -> list[dict[str, Any]]:
    root = references_dir(project_path) / REFERENCE_VIDEO_EDITOR_DIRNAME
    if not root.is_dir():
        return []
    out: list[dict[str, Any]] = []
    for child in root.iterdir():
        if not child.is_dir():
            continue
        meta = _read_video_editor_meta(child / VIDEO_EDITOR_META_FILENAME)
        name = sanitize_video_editor_store_name(meta.get("name") or child.name)
        row = video_editor_project_payload(project_path, name, meta)
        try:
            mtime = child.stat().st_mtime
        except OSError:
            mtime = 0.0
        row["mtime"] = mtime
        out.append(row)
    out.sort(key=lambda row: float(row.get("mtime") or 0), reverse=True)
    return out


def delete_video_editor_store(project_path: Path, name: str) -> bool:
    dest = video_editor_store_dir(project_path, name, create=False)
    if not dest.is_dir():
        return False
    shutil.rmtree(dest, ignore_errors=True)
    return True


def rename_video_editor_store(project_path: Path, old_name: str, new_name: str) -> str:
    """Rename a nested Video Editor project folder, creating the dest if needed."""
    old_key = sanitize_video_editor_store_name(old_name)
    new_key = sanitize_video_editor_store_name(new_name)
    root = references_dir(project_path) / REFERENCE_VIDEO_EDITOR_DIRNAME
    src = root / old_key
    dest = root / new_key
    if old_key == new_key:
        if not dest.is_dir():
            write_video_editor_project(project_path, new_key)
        return new_key
    if dest.exists() and dest.resolve() != src.resolve():
        raise ValueError("A Video Editor folder with that name already exists.")
    dest.parent.mkdir(parents=True, exist_ok=True)
    if src.is_dir():
        src.rename(dest)
    else:
        dest.mkdir(parents=True, exist_ok=True)
    meta = dest / VIDEO_EDITOR_META_FILENAME
    payload = _read_video_editor_meta(meta)
    payload["name"] = new_key
    from datetime import datetime, timezone
    payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    if "created_at" not in payload:
        payload["created_at"] = payload["updated_at"]
    payload.setdefault("editors", [])
    meta.write_text(json.dumps(payload), encoding="utf-8")
    return new_key


def ar_references_dir(project_path: Path) -> Path:
    return reference_subdir(project_path, REFERENCE_AR_DIRNAME)


def recordings_references_dir(project_path: Path) -> Path:
    return reference_subdir(project_path, REFERENCE_SCREEN_RECORDINGS_DIRNAME)


def screenshots_references_dir(project_path: Path) -> Path:
    return reference_subdir(project_path, REFERENCE_SCREENSHOTS_DIRNAME)


def mcmaster_references_dir(project_path: Path) -> Path:
    return reference_subdir(project_path, REFERENCE_MCMASTER_DIRNAME)


def mcmaster_parts_list_path(project_path: Path) -> Path:
    return mcmaster_references_dir(project_path) / MCMASTER_PARTS_LIST_FILENAME


_MCMASTER_PN_RE = re.compile(r"\b([0-9]{4,6}[A-Z][0-9A-Z]{2,8})\b")
_MCMASTER_TABLE_ROW_RE = re.compile(
    r"^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*"
    r"(?:\|\s*([^|]*?)\s*)?\|?\s*$"
)


_MCMASTER_WEAK_STATUSES = {"", "planned", "fetching", "retrying", "searching"}
_MCMASTER_READY_STATUSES = {"on_server", "used", "downloaded", "substituted"}


def _normalize_mcmaster_pn(value: str) -> str:
    return re.sub(r"[^0-9A-Za-z]", "", str(value or "")).upper()


def _merge_mcmaster_status(prev: str, incoming: str) -> str:
    """Keep a successful fetch; CAD briefs often restate PNs as `planned`."""
    previous = str(prev or "").strip()
    nxt = str(incoming or "").strip()
    if not nxt:
        return previous or "planned"
    prev_key = previous.lower()
    next_key = nxt.lower()
    if next_key == "removed":
        return nxt
    if prev_key in _MCMASTER_READY_STATUSES and next_key in _MCMASTER_WEAK_STATUSES:
        return previous
    if prev_key == "used" and next_key == "on_server":
        return previous
    return nxt


def mcmaster_catalog_filename_on_disk(project_path: Path, part_number: str) -> str | None:
    """Return STEP/GLB filename when this PN is already on the server."""
    pn = _normalize_mcmaster_pn(part_number)
    if not pn:
        return None
    root = Path(project_path)
    folders = [root]
    lib = root / MCMASTER_LIBRARY_DIRNAME
    if lib.is_dir():
        folders.append(lib)
    for folder in folders:
        for suffix in (".glb", ".gltf", ".step", ".stp"):
            path = folder / f"{pn}{suffix}"
            try:
                if path.is_file() and path.stat().st_size > 64:
                    return path.name
            except OSError:
                continue
    return None


def mcmaster_buy_url(part_number: str) -> str:
    pn = _normalize_mcmaster_pn(part_number)
    return f"https://www.mcmaster.com/{pn}/" if pn else "https://www.mcmaster.com/"


_MD_LINK_RE = re.compile(r"\[([^\]]+)\]\((https?://[^)\s]+)\)")


def _mcmaster_cell_text(value: str) -> str:
    raw = str(value or "").strip()
    match = _MD_LINK_RE.search(raw)
    if match:
        return match.group(1).strip()
    return raw


def _mcmaster_cell_url(value: str) -> str:
    raw = str(value or "").strip()
    match = _MD_LINK_RE.search(raw)
    if match:
        return match.group(2).rstrip(".,;")
    link = re.search(r"https?://[^\s)|]+", raw)
    return (link.group(0) if link else "").rstrip(".,);")


def mcmaster_product_label(description: str, part_number: str) -> str:
    """Human name for a buy link — product title, not the word McMaster."""
    name = _mcmaster_cell_text(description)
    name = re.sub(r"\s*/\s*McMaster-Carr\s*$", "", name, flags=re.I).strip()
    name = re.sub(r"\s+", " ", name)
    if not name or name.lower() in {"tbd", "—", "-", "mcmaster", "buy"}:
        return str(part_number or "McMaster-Carr").strip() or "McMaster-Carr"
    return name


def is_per_part_mcmaster_markdown(name: str) -> bool:
    """True for leftover ``mcmaster_91290A115.md`` specs — not ``parts_list.md``."""
    stem = Path(str(name or "")).name
    low = stem.lower()
    if low == MCMASTER_PARTS_LIST_FILENAME.lower():
        return False
    return low.startswith("mcmaster_") and low.endswith(".md")


def _mcmaster_library_reference_name(value: str | None) -> str:
    raw = Path(str(value or "")).name.strip()
    if is_per_part_mcmaster_markdown(raw) or not raw:
        return MCMASTER_PARTS_LIST_FILENAME
    return raw


def read_mcmaster_parts_list(project_path: Path) -> str:
    path = mcmaster_parts_list_path(project_path)
    if not path.is_file():
        return ""
    try:
        return path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ""


def parse_mcmaster_parts_rows(text: str) -> list[dict[str, str]]:
    """Parse qty/pn/description rows from a McMaster parts list markdown."""
    rows: list[dict[str, str]] = []
    seen: set[str] = set()
    for raw in str(text or "").splitlines():
        line = raw.strip()
        if not line.startswith("|") or re.match(r"^\|\s*-+", line):
            continue
        m = _MCMASTER_TABLE_ROW_RE.match(line)
        if not m:
            continue
        qty, pn, desc, used_in, status = [c.strip() for c in m.groups()[:5]]
        buy = (m.group(6) or "").strip() if m.lastindex and m.lastindex >= 6 else ""
        pn_text = _mcmaster_cell_text(pn)
        desc_text = _mcmaster_cell_text(desc)
        headerish = {qty.lower(), pn_text.lower(), desc_text.lower(), status.lower()}
        if "qty" in headerish or "part number" in headerish or pn_text.lower() == "pn" or pn_text.lower() == "buy":
            continue
        extracted = (
            _MCMASTER_PN_RE.search(pn_text)
            or _MCMASTER_PN_RE.search(pn)
            or _MCMASTER_PN_RE.search(_normalize_mcmaster_pn(pn_text))
        )
        pn_clean = _normalize_mcmaster_pn(extracted.group(1) if extracted else pn_text)
        if not pn_clean or not _MCMASTER_PN_RE.fullmatch(pn_clean):
            # Still keep free-form catalog ids if they look like McMaster PNs loosely.
            if not re.search(r"[0-9].*[A-Za-z]|[A-Za-z].*[0-9]", pn_text):
                continue
            pn_clean = pn_text.strip()
        key = _normalize_mcmaster_pn(pn_clean)
        if not key or key in seen:
            continue
        seen.add(key)
        buy_url = _mcmaster_cell_url(buy) or _mcmaster_cell_url(pn) or _mcmaster_cell_url(desc)
        if not buy_url:
            buy_url = mcmaster_buy_url(pn_clean)
        rows.append(
            {
                "qty": qty or "1",
                "part_number": pn_clean,
                "description": desc_text or "",
                "used_in": _mcmaster_cell_text(used_in) or used_in or "",
                "status": status or "planned",
                "buy_url": buy_url,
            }
        )
    # Also harvest bare part numbers from bullets when table is sparse.
    for match in _MCMASTER_PN_RE.finditer(str(text or "")):
        pn = match.group(1)
        key = _normalize_mcmaster_pn(pn)
        if key in seen:
            continue
        seen.add(key)
        rows.append(
            {
                "qty": "1",
                "part_number": pn,
                "description": "",
                "used_in": "",
                "status": "planned",
                "buy_url": mcmaster_buy_url(pn),
            }
        )
    return rows


def extract_mcmaster_section_from_brief(cad_brief: str) -> str:
    """Return the McMaster / purchased-hardware section from a CAD brief, if present."""
    text = str(cad_brief or "")
    if not text.strip():
        return ""
    lines = text.splitlines()
    start = None
    for i, line in enumerate(lines):
        low = line.lower()
        if re.search(r"mcmaster|purchased hardware|cots|catalog parts|hardware list", low):
            start = i
            break
    if start is None:
        # Fall back to any lines that already mention McMaster PNs.
        hits = [ln for ln in lines if _MCMASTER_PN_RE.search(ln)]
        return "\n".join(hits).strip()
    chunk = [lines[start]]
    for line in lines[start + 1 :]:
        if re.match(r"^#{1,3}\s+\S", line) or (
            line.startswith("- ")
            and re.match(
                r"^- (model|task type|units|coordinate|overall|functional|manufacturing|"
                r"positioning|paths|validation|assumptions)\b",
                line,
                flags=re.I,
            )
        ):
            # Stop at next top-level brief bullet that is not hardware-related.
            low = line.lower()
            if not re.search(r"mcmaster|hardware|fastener|bearing|standoff|screw|nut|cots", low):
                break
        chunk.append(line)
    return "\n".join(chunk).strip()


def render_mcmaster_parts_list_markdown(
    rows: list[dict[str, str]],
    *,
    notes: str = "",
    is_edit: bool = False,
) -> str:
    header = (
        "# McMaster-Carr parts list\n\n"
        "Production hardware for this CAD model. Click a **product name** to open "
        "the live McMaster page and order that part number. STEPs are stored on the "
        "studio server so Generate can import them.\n\n"
        "This is the only McMaster markdown in the project. On generative edits, "
        "append newly required part numbers and mark unused lines `removed`.\n\n"
    )
    lines = [
        header,
        "| Qty | Part number | Description | Used in | Status | Buy |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    if rows:
        for row in rows:
            pn = str(row.get("part_number") or "").replace("|", "/")
            buy = str(row.get("buy_url") or "").strip() or mcmaster_buy_url(pn)
            desc = str(row.get("description") or "").replace("|", "/")
            label = mcmaster_product_label(desc, pn).replace("|", "/")
            pn_cell = f"[{pn}]({buy})" if buy and pn else pn
            desc_cell = f"[{label}]({buy})" if buy and label else desc
            buy_cell = f"[{label}]({buy})" if buy else "—"
            lines.append(
                "| {qty} | {part_number} | {description} | {used_in} | {status} | {buy} |".format(
                    qty=str(row.get("qty") or "1").replace("|", "/"),
                    part_number=pn_cell.replace("|", "/"),
                    description=desc_cell.replace("|", "/"),
                    used_in=str(row.get("used_in") or "").replace("|", "/"),
                    status=str(row.get("status") or "planned").replace("|", "/"),
                    buy=buy_cell.replace("|", "/"),
                )
            )
    else:
        lines.append("| — | TBD | Identify required McMaster hardware during CAD brief | — | planned |")
    if notes.strip():
        lines.extend(["", "## Notes", notes.strip()])
    if is_edit:
        lines.extend(
            [
                "",
                "## Edit log",
                f"- Updated during generative edit.",
            ]
        )
    return "\n".join(lines).rstrip() + "\n"


def sync_mcmaster_parts_list(
    project_path: Path,
    *,
    cad_brief: str = "",
    user_prompt: str = "",
    is_edit: bool = False,
) -> dict[str, Any]:
    """Create/update references/McMaster/parts_list.md from the CAD brief + prior list."""
    existing_text = read_mcmaster_parts_list(project_path)
    existing_rows = parse_mcmaster_parts_rows(existing_text)
    section = extract_mcmaster_section_from_brief(cad_brief)
    source_blob = "\n".join(
        [
            section,
            str(cad_brief or ""),
            str(user_prompt or ""),
        ]
    )
    incoming = parse_mcmaster_parts_rows(section) or parse_mcmaster_parts_rows(source_blob)

    by_pn: dict[str, dict[str, str]] = {}
    for row in existing_rows:
        key = _normalize_mcmaster_pn(row.get("part_number") or "")
        if key:
            by_pn[key] = dict(row)

    incoming_keys = set()
    for row in incoming:
        key = _normalize_mcmaster_pn(row.get("part_number") or "")
        if not key:
            continue
        incoming_keys.add(key)
        prev = by_pn.get(key)
        if prev:
            merged = dict(prev)
            for field in ("qty", "description", "used_in", "buy_url"):
                val = str(row.get(field) or "").strip()
                if val:
                    merged[field] = val
            merged["status"] = _merge_mcmaster_status(
                str(merged.get("status") or ""),
                str(row.get("status") or ""),
            )
            if merged.get("status", "").lower() == "removed":
                merged["status"] = "planned"
            by_pn[key] = merged
        else:
            by_pn[key] = {
                "qty": row.get("qty") or "1",
                "part_number": row.get("part_number") or key,
                "description": row.get("description") or "",
                "used_in": row.get("used_in") or "",
                "status": row.get("status") or "planned",
                "buy_url": row.get("buy_url") or mcmaster_buy_url(key),
            }

    # On edits, keep prior rows that were not restated; author may mark removed in brief.
    if is_edit and existing_rows and incoming:
        remove_hints = set()
        for match in re.finditer(
            r"(?:remove|drop|unused|no longer needs?)\s+([0-9]{4,6}[A-Za-z][0-9A-Za-z]{2,8})",
            source_blob,
            flags=re.I,
        ):
            remove_hints.add(_normalize_mcmaster_pn(match.group(1)))
        for key, row in list(by_pn.items()):
            if key in remove_hints:
                row["status"] = "removed"

    rows = sorted(
        by_pn.values(),
        key=lambda r: (
            0 if str(r.get("status") or "").lower() != "removed" else 1,
            str(r.get("part_number") or ""),
        ),
    )
    notes = ""
    if section:
        # Keep non-table prose from the brief section as notes.
        note_lines = [
            ln
            for ln in section.splitlines()
            if ln.strip() and not ln.strip().startswith("|") and not re.match(r"^#+\s", ln.strip())
        ]
        notes = "\n".join(note_lines[:40]).strip()

    markdown = render_mcmaster_parts_list_markdown(rows, notes=notes, is_edit=is_edit)
    dest = mcmaster_parts_list_path(project_path)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(markdown, encoding="utf-8")
    return {
        "path": f"references/{REFERENCE_MCMASTER_DIRNAME}/{MCMASTER_PARTS_LIST_FILENAME}",
        "filename": MCMASTER_PARTS_LIST_FILENAME,
        "folder": REFERENCE_MCMASTER_DIRNAME,
        "count": len([r for r in rows if str(r.get("status") or "").lower() != "removed"]),
        "rows": rows,
        "markdown": markdown,
    }


def mark_mcmaster_parts_used(
    project_path: Path,
    used: list[dict[str, Any]],
) -> dict[str, Any]:
    """Set status=used (and qty/used_in) for PNs the model actually imported."""
    existing_text = read_mcmaster_parts_list(project_path)
    rows = parse_mcmaster_parts_rows(existing_text)
    by_pn: dict[str, dict[str, str]] = {}
    for row in rows:
        key = _normalize_mcmaster_pn(row.get("part_number") or "")
        if key:
            by_pn[key] = dict(row)
    applied: list[dict[str, Any]] = []
    for raw in used or []:
        if not isinstance(raw, dict):
            continue
        key = _normalize_mcmaster_pn(str(raw.get("part_number") or raw.get("pn") or ""))
        if not key:
            continue
        prev = by_pn.get(key) or {
            "qty": "1",
            "part_number": str(raw.get("part_number") or key),
            "description": "",
            "used_in": "",
            "status": "used",
            "buy_url": mcmaster_buy_url(key),
        }
        qty = str(raw.get("qty") or "").strip()
        if qty:
            prev["qty"] = qty
        used_in = str(raw.get("used_in") or raw.get("filename") or "").strip()
        if used_in:
            prev["used_in"] = used_in
        desc = str(raw.get("description") or "").strip()
        if desc and not prev.get("description"):
            prev["description"] = desc
        prev["status"] = "used"
        prev["buy_url"] = prev.get("buy_url") or mcmaster_buy_url(key)
        by_pn[key] = prev
        applied.append(prev)
    ordered = sorted(
        by_pn.values(),
        key=lambda r: (
            0 if str(r.get("status") or "").lower() != "removed" else 1,
            str(r.get("part_number") or ""),
        ),
    )
    markdown = render_mcmaster_parts_list_markdown(ordered)
    dest = mcmaster_parts_list_path(project_path)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(markdown, encoding="utf-8")
    return {"rows": ordered, "applied": applied, "markdown": markdown, "path": str(dest)}


_MCMASTER_LIST_LOCK = threading.Lock()


def upsert_mcmaster_part(
    project_path: Path,
    part_number: str,
    **fields: Any,
) -> dict[str, Any]:
    """Create or update one parts-list row (status, filename, description, …)."""
    with _MCMASTER_LIST_LOCK:
        return _upsert_mcmaster_part_unlocked(project_path, part_number, **fields)


def _upsert_mcmaster_part_unlocked(
    project_path: Path,
    part_number: str,
    **fields: Any,
) -> dict[str, Any]:
    """Create or update one parts-list row (status, filename, description, …)."""
    key = _normalize_mcmaster_pn(part_number)
    if not key:
        return {}
    existing_text = read_mcmaster_parts_list(project_path)
    rows = parse_mcmaster_parts_rows(existing_text)
    by_pn: dict[str, dict[str, str]] = {}
    for row in rows:
        k = _normalize_mcmaster_pn(row.get("part_number") or "")
        if k:
            by_pn[k] = dict(row)
    prev = by_pn.get(key) or {
        "qty": "1",
        "part_number": str(part_number or key),
        "description": "",
        "used_in": "",
        "status": "planned",
        "buy_url": mcmaster_buy_url(key),
    }
    for field, val in fields.items():
        if val is None:
            continue
        text = str(val).strip()
        if text:
            prev[field] = text
    prev["buy_url"] = prev.get("buy_url") or mcmaster_buy_url(key)
    by_pn[key] = prev
    ordered = sorted(
        by_pn.values(),
        key=lambda r: (
            0 if str(r.get("status") or "").lower() != "removed" else 1,
            str(r.get("part_number") or ""),
        ),
    )
    markdown = render_mcmaster_parts_list_markdown(ordered)
    dest = mcmaster_parts_list_path(project_path)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(markdown, encoding="utf-8")
    return prev


def mcmaster_parts_progress(project_path: Path) -> dict[str, Any]:
    """Compact parts-list payload for the generation HUD (live McMaster panel)."""
    rows = parse_mcmaster_parts_rows(read_mcmaster_parts_list(project_path))
    slim: list[dict[str, str]] = []
    for row in rows:
        if str(row.get("status") or "").lower() == "removed":
            continue
        pn = str(row.get("part_number") or "").strip()
        if not pn:
            continue
        status = str(row.get("status") or "planned")
        status_key = status.lower()
        if status_key not in _MCMASTER_READY_STATUSES and status_key != "removed":
            on_disk = mcmaster_catalog_filename_on_disk(project_path, pn)
            if on_disk:
                status = "on_server"
        slim.append(
            {
                "qty": str(row.get("qty") or "1"),
                "part_number": pn,
                "description": str(row.get("description") or "")[:120],
                "used_in": str(row.get("used_in") or "")[:80],
                "status": status,
                "buy_url": str(row.get("buy_url") or mcmaster_buy_url(pn)),
            }
        )
        if len(slim) >= 40:
            break
    done = sum(1 for row in slim if str(row.get("status") or "").lower() in {"on_server", "used", "downloaded", "substituted"})
    fetching = sum(1 for row in slim if str(row.get("status") or "").lower() in {"fetching", "retrying", "searching"})
    payload = {
        "mcmaster_parts": slim,
        "mcmaster_count": len(slim),
        "mcmaster_done": done,
        "mcmaster_total": len(slim),
        "mcmaster_fetching": fetching,
    }
    try:
        from backend.services.electronics_build import electronics_parts_progress

        payload.update(electronics_parts_progress(project_path))
    except Exception:
        payload.setdefault("electronics_parts", [])
        payload.setdefault("electronics_count", 0)
    return payload


def is_markup_path(project_path: Path, file_path: Path) -> bool:
    """True when file lives under references/ (incl. AR/) or renders/."""
    try:
        rel = Path(file_path).resolve().relative_to(Path(project_path).resolve())
    except ValueError:
        return False
    parts = rel.parts
    if not parts:
        return False
    if parts[0] == RENDERS_DIRNAME:
        return True
    if parts[0] == IMAGINE_DIRNAME and all(p not in {".", ".."} for p in parts):
        return True
    if parts[0] != REFERENCE_DIRNAME:
        return False
    if len(parts) == 2:
        return True
    if len(parts) == 3 and parts[1] in REFERENCE_SUBFOLDERS:
        return True
    # Nested Improve Lab / Canvas / Video Editor stores: references/{folder}/{name}/{file}
    if (
        len(parts) >= 4
        and parts[1] in {
            REFERENCE_IMPROVE_LAB_DIRNAME,
            REFERENCE_CANVAS_DIRNAME,
            REFERENCE_VIDEO_EDITOR_DIRNAME,
            REFERENCE_CODE_DIRNAME,
        }
        and all(p not in {".", ".."} for p in parts)
    ):
        return True
    if len(parts) == 3 and parts[1] == REFERENCE_CODE_DIRNAME and all(p not in {".", ".."} for p in parts):
        return True
    return False


def renders_dir(project_path: Path) -> Path:
    path = Path(project_path) / RENDERS_DIRNAME
    path.mkdir(parents=True, exist_ok=True)
    return path


def mcmaster_library_dir(project_path: Path) -> Path:
    path = Path(project_path) / MCMASTER_LIBRARY_DIRNAME
    path.mkdir(parents=True, exist_ok=True)
    return path


def mcmaster_library_index_path(project_path: Path) -> Path:
    return mcmaster_library_dir(project_path) / "index.json"


def list_mcmaster_library(project_path: Path) -> list[dict[str, Any]]:
    """Return McMaster insert library entries for a project."""
    index_path = Path(project_path) / MCMASTER_LIBRARY_DIRNAME / "index.json"
    entries: list[dict[str, Any]] = []
    if index_path.is_file():
        try:
            raw = json.loads(index_path.read_text(encoding="utf-8"))
            for item in raw.get("entries") or []:
                if not isinstance(item, dict):
                    continue
                name = str(item.get("name") or item.get("filename") or "").strip()
                if not name:
                    continue
                entries.append(
                    {
                        "name": name,
                        "filename": str(item.get("filename") or name),
                        "at": item.get("at") or item.get("imported_at"),
                        "source": item.get("source") or "mcmaster",
                        "page_url": str(item.get("page_url") or "").strip(),
                        "reference": str(item.get("reference") or "").strip(),
                        "part_number": str(item.get("part_number") or "").strip(),
                        "title": str(item.get("title") or "").strip(),
                        "project_filename": str(item.get("project_filename") or name).strip(),
                    }
                )
        except Exception:
            entries = []
    if entries:
        return entries[:48]

    # Fallback: scan folder for CAD files if index is missing.
    from datetime import datetime, timezone

    root = Path(project_path) / MCMASTER_LIBRARY_DIRNAME
    if not root.is_dir():
        return []
    scanned: list[dict[str, Any]] = []
    for f in sorted(root.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if not f.is_file() or f.name == "index.json":
            continue
        if f.suffix.lower() not in SUPPORTED_IMPORT:
            continue
        scanned.append(
            {
                "name": f.name,
                "filename": f.name,
                "at": datetime.fromtimestamp(f.stat().st_mtime, tz=timezone.utc).isoformat(),
                "source": "mcmaster",
            }
        )
    return scanned[:48]


def record_mcmaster_library_entries(
    project_path: Path,
    filenames: list[str],
    *,
    source: str = "mcmaster",
    page_urls: dict[str, str] | None = None,
    part_numbers: dict[str, str] | None = None,
    references: dict[str, str] | None = None,
    titles: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    """Copy imported CAD into mcmaster_library/ and append to index.json."""
    import shutil
    from datetime import datetime, timezone

    lib = mcmaster_library_dir(project_path)
    index_path = mcmaster_library_index_path(project_path)
    existing = list_mcmaster_library(project_path)
    by_name = {e["name"]: e for e in existing}
    # Also index by project CAD filename for metadata updates without re-copy.
    by_project = {
        str(e.get("project_filename") or e.get("name") or ""): e
        for e in existing
        if str(e.get("project_filename") or e.get("name") or "")
    }
    now = datetime.now(timezone.utc).isoformat()
    added: list[dict[str, Any]] = []
    urls = page_urls or {}
    pns = part_numbers or {}
    refs = references or {}
    titles_map = titles or {}

    for raw_name in filenames or []:
        name = Path(str(raw_name or "")).name.strip()
        if not name:
            continue
        src = Path(project_path) / name
        if not src.is_file():
            # Also accept files already under the library folder.
            src_lib = lib / name
            if src_lib.is_file():
                src = src_lib
            else:
                # Metadata-only update for an existing library/project entry.
                existing_entry = by_name.get(name) or by_project.get(name)
                if not existing_entry:
                    continue
                dest_name = str(existing_entry.get("name") or name)
                page_url = str(
                    urls.get(name) or urls.get(dest_name) or existing_entry.get("page_url") or ""
                ).strip()
                part_number = str(
                    pns.get(name) or pns.get(dest_name) or existing_entry.get("part_number") or ""
                ).strip()
                title = str(
                    titles_map.get(name) or titles_map.get(dest_name) or existing_entry.get("title") or ""
                ).strip()
                reference = str(
                    refs.get(name) or refs.get(dest_name) or existing_entry.get("reference") or ""
                ).strip()
                if not reference and part_number:
                    reference = MCMASTER_PARTS_LIST_FILENAME
                elif not reference:
                    reference = MCMASTER_PARTS_LIST_FILENAME
                reference = _mcmaster_library_reference_name(reference)
                entry = {
                    **existing_entry,
                    "at": now,
                    "source": source or existing_entry.get("source") or "mcmaster",
                    "page_url": page_url,
                    "part_number": part_number,
                    "title": title,
                    "reference": reference,
                }
                by_name[dest_name] = entry
                added.append(entry)
                continue
        dest = lib / name
        if src.resolve() != dest.resolve():
            if dest.exists():
                stem, suffix = dest.stem, dest.suffix
                n = 2
                while True:
                    candidate = lib / f"{stem}_{n}{suffix}"
                    if not candidate.exists():
                        dest = candidate
                        break
                    n += 1
            shutil.copy2(src, dest)
        page_url = str(urls.get(name) or urls.get(dest.name) or "").strip()
        part_number = str(pns.get(name) or pns.get(dest.name) or "").strip()
        title = str(titles_map.get(name) or titles_map.get(dest.name) or "").strip()
        reference = str(refs.get(name) or refs.get(dest.name) or "").strip()
        if not reference and part_number:
            reference = MCMASTER_PARTS_LIST_FILENAME
        elif not reference:
            reference = MCMASTER_PARTS_LIST_FILENAME
        reference = _mcmaster_library_reference_name(reference)
        entry = {
            "name": dest.name,
            "filename": dest.name,
            "at": now,
            "source": source or "mcmaster",
            "project_filename": name,
            "page_url": page_url,
            "part_number": part_number,
            "title": title,
            "reference": reference,
        }
        by_name[dest.name] = entry
        added.append(entry)

    ordered = sorted(by_name.values(), key=lambda e: str(e.get("at") or ""), reverse=True)[:48]
    index_path.write_text(json.dumps({"entries": ordered}, indent=2), encoding="utf-8")
    for entry in added:
        pn = str(entry.get("part_number") or "").strip()
        if not pn:
            continue
        try:
            upsert_mcmaster_part(
                project_path,
                pn,
                description=str(entry.get("title") or ""),
                buy_url=str(entry.get("page_url") or "") or None,
                used_in=str(entry.get("project_filename") or entry.get("name") or ""),
                status="on_server",
            )
        except Exception:
            continue
    return added


def find_mcmaster_library_entry(project_path: Path, cad_filename: str) -> dict[str, Any] | None:
    """Match a project CAD filename to a McMaster library entry."""
    want = Path(str(cad_filename or "")).name.strip().lower()
    if not want:
        return None
    stem = Path(want).stem.lower()
    best = None
    for entry in list_mcmaster_library(project_path):
        names = {
            str(entry.get("name") or "").strip().lower(),
            str(entry.get("filename") or "").strip().lower(),
            str(entry.get("project_filename") or "").strip().lower(),
        }
        if want in names:
            return entry
        if stem and Path(str(entry.get("project_filename") or entry.get("name") or "")).stem.lower() == stem:
            best = best or entry
        pn = str(entry.get("part_number") or "").strip().lower()
        if pn and (stem.startswith(pn) or want.startswith(pn)):
            best = best or entry
    return best


def load_mcmaster_reference_markdown(project_path: Path, entry: dict[str, Any] | None) -> str:
    """Load the AI reference markdown for a McMaster library entry."""
    if not entry:
        return ""
    candidates: list[Path] = [mcmaster_parts_list_path(project_path)]
    ref_name = Path(str(entry.get("reference") or "")).name.strip()
    if ref_name:
        candidates.append(Path(project_path) / REFERENCE_DIRNAME / ref_name)
        candidates.append(Path(project_path) / REFERENCE_DIRNAME / REFERENCE_MCMASTER_DIRNAME / ref_name)
        candidates.append(Path(project_path) / ref_name)
    for path in candidates:
        if path.is_file():
            try:
                return path.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue
    return ""


def is_reference_suffix(suffix: str) -> bool:
    return str(suffix or "").lower() in SUPPORTED_REFERENCE


def reference_kind(filename: str) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix in REFERENCE_IMAGE_SUFFIXES:
        return "image"
    if suffix in REFERENCE_VIDEO_SUFFIXES:
        return "video"
    if suffix in REFERENCE_AUDIO_SUFFIXES:
        return "audio"
    if suffix == ".pdf":
        return "pdf"
    if suffix in REFERENCE_TEXT_SUFFIXES:
        return "text"
    return "file"


_CREATE_PRIMITIVE_STEM_RE = re.compile(
    r"^(?:xr_)?(box|cylinder|sphere|cone|torus)\d*$",
    re.I,
)


def looks_like_create_primitive_stem(stem: str) -> bool:
    """True for FreeCAD Create / VR instant primitives (box, box2, xr_box, …)."""
    text = Path(str(stem or "")).name
    if "." in text and not text.startswith("."):
        text = Path(text).stem
    return bool(_CREATE_PRIMITIVE_STEM_RE.fullmatch(text))


def looks_like_mcmaster_part_stem(stem: str) -> bool:
    """True for a McMaster-Carr catalog number used as a project file stem."""
    raw = Path(str(stem or "")).name
    base = Path(raw).stem if Path(raw).suffix else raw
    root, _depth = _edit_variant_depth(base)
    clean = _normalize_mcmaster_pn(root)
    return bool(clean) and bool(_MCMASTER_PN_RE.fullmatch(clean))


def looks_like_step_file(path: Path) -> bool:
    """True when *path* is ISO-10303 STEP, not an MSI/HTML/PDF with a .step name."""
    try:
        with Path(path).open("rb") as fh:
            head = fh.read(2048)
    except OSError:
        return False
    if not head or head.startswith(b"\xd0\xcf\x11\xe0"):  # OLE / MSI
        return False
    stripped = head.lstrip()
    if stripped.startswith(b"%PDF") or stripped.startswith(b"<"):
        return False
    return b"ISO-10303" in head[:1024]


def looks_like_drive_id_stub(path: Path) -> bool:
    """True when *path* is a Google Drive ``{"id": "..."}`` pointer saved as .glb."""
    from backend.services.engine_layout import looks_like_drive_id_stub as _is_stub

    return _is_stub(path)


_FILE_API_SUFFIXES = frozenset({
    "exports",
    "bodies",
    "dxf-preview",
    "markup",
    "step-module",
    "cad-params",
    "slicer-layout",
})


def split_file_api_suffix(filename: str) -> tuple[str, str | None]:
    """Split a catch-all ``foo.glb/exports`` path into ``(model, suffix)``.

    GET ``/files/{filename:path}`` registered before ``/exports`` swallows the
    suffix. Callers should dispatch on the suffix instead of 404ing ``exports``.
    """
    raw = str(filename or "").replace("\\", "/").strip()
    parts = [p for p in raw.split("/") if p and p not in {".", ".."}]
    if len(parts) >= 2 and parts[-1].lower() in _FILE_API_SUFFIXES:
        return "/".join(parts[:-1]), parts[-1].lower()
    return raw, None


def path_as_dirent(path: Path) -> Path:
    """Return *path* using the directory entry's real spelling (``.STEP`` vs ``.step``)."""
    path = Path(path)
    try:
        want = path.name.lower()
        for child in path.parent.iterdir():
            if child.is_file() and child.name.lower() == want:
                return child
    except OSError:
        pass
    return path


def _find_cad_file_in_dir(folder: Path, clean: str, lowered: set[str]) -> Path | None:
    """Match *clean* plus one of *lowered* suffixes inside a single directory."""
    if not folder.is_dir():
        return None
    for suffix in sorted(lowered):
        candidate = folder / f"{clean}{suffix}"
        if candidate.is_file():
            if suffix in STEP_SUFFIXES and not looks_like_step_file(candidate):
                continue
            if suffix in {".glb", ".gltf"} and looks_like_drive_id_stub(candidate):
                continue
            return path_as_dirent(candidate)
        upper = folder / f"{clean}{suffix.upper()}"
        if upper.is_file():
            if suffix in STEP_SUFFIXES and not looks_like_step_file(upper):
                continue
            if suffix in {".glb", ".gltf"} and looks_like_drive_id_stub(upper):
                continue
            return path_as_dirent(upper)
    lower_stem = clean.lower()
    try:
        for path in folder.iterdir():
            if (
                path.is_file()
                and not path.name.startswith(".")
                and path.stem.lower() == lower_stem
                and path.suffix.lower() in lowered
                and not (path.suffix.lower() in STEP_SUFFIXES and not looks_like_step_file(path))
                and not (path.suffix.lower() in {".glb", ".gltf"} and looks_like_drive_id_stub(path))
            ):
                return path
    except OSError:
        pass
    return None


def find_cad_file_for_stem(project_path: Path, stem: str, suffixes: set[str]) -> Path | None:
    """Locate a CAD file for a model stem, matching suffix case-insensitively.

    Also looks in ``mcmaster_library/`` so catalog STEPs/GLBs are found without
    crawling McMaster again.
    """
    project_path = Path(project_path)
    raw = str(stem or "").strip()
    if not raw or not suffixes:
        return None
    lowered = {str(s).lower() for s in suffixes}
    clean = Path(raw).stem if Path(raw).suffix.lower() in lowered else raw
    found = _find_cad_file_in_dir(project_path, clean, lowered)
    if found is not None:
        return found
    from backend.services.engine_layout import ENGINE_FOLDERS

    for folder in ENGINE_FOLDERS:
        found = _find_cad_file_in_dir(project_path / folder, clean, lowered)
        if found is not None:
            return found
    if project_path.name != MCMASTER_LIBRARY_DIRNAME:
        lib = project_path / MCMASTER_LIBRARY_DIRNAME
        found = _find_cad_file_in_dir(lib, clean, lowered)
        if found is not None:
            return found
    return None


def find_step_source(project_path: Path, stem: str) -> Path | None:
    """Locate a STEP/STP file for a model stem on a case-sensitive filesystem."""
    return find_cad_file_for_stem(project_path, stem, STEP_SUFFIXES)


def find_proprietary_cad_source(project_path: Path, stem: str) -> Path | None:
    """Locate a SolidWorks / Parasolid / SAT / Fusion native for a model stem."""
    return find_cad_file_for_stem(project_path, stem, PROPRIETARY_CAD_SUFFIXES)


def ensure_step_for_preview(project_path: Path, stem: str) -> Path | None:
    """Return a STEP file for *stem*, converting proprietary CAD when possible.

    Native SolidWorks/Fusion files are skipped unless ``CAD_CONVERTER_CMD`` is set —
    FreeCAD cannot read real ``.sldprt`` and a 3-minute failed import would block
    ``GET /files/*.glb``.
    """
    step = find_step_source(project_path, stem)
    if step is not None:
        return step
    prop = find_proprietary_cad_source(project_path, stem)
    if prop is None:
        return None
    from backend.services.cad_proprietary_convert import (
        FUSION_NATIVE_SUFFIXES,
        SOLIDWORKS_SUFFIXES,
        try_convert_proprietary_cad,
    )

    suffix = prop.suffix.lower()
    if suffix in SOLIDWORKS_SUFFIXES | FUSION_NATIVE_SUFFIXES and not (
        os.environ.get("CAD_CONVERTER_CMD") or ""
    ).strip():
        return None
    converted = try_convert_proprietary_cad(prop, project_path)
    if not converted or not converted.get("path"):
        return None
    out = Path(converted["path"])
    if out.suffix.lower() not in STEP_SUFFIXES:
        return None
    clean = Path(stem).stem if Path(str(stem)).suffix.lower() in (
        STEP_SUFFIXES | PROPRIETARY_CAD_SUFFIXES
    ) else str(stem)
    preferred = Path(project_path) / f"{clean}.step"
    if out.resolve() != preferred.resolve() and not preferred.exists():
        try:
            shutil.copy2(out, preferred)
            return preferred
        except OSError:
            return out
    return out


def strip_virtual_body_filename(filename: str | None) -> str:
    """Drop browser suffixes like ``part.glb#body:2`` so file routes hit real CAD."""
    raw = str(filename or "").strip().replace("\\", "/")
    if "#body:" in raw:
        raw = raw.split("#body:", 1)[0].strip()
    return raw


def resolve_project_file(project_path: Path, filename: str) -> Path | None:
    """Resolve a basename in the project root, references/ (+ AR/), or renders/."""
    from backend.services.engine_layout import ENGINE_FOLDER_SET, resolve_in_layout, _decode_rel

    raw = _decode_rel(strip_virtual_body_filename(filename))
    if not raw or ".." in raw.split("/"):
        return None
    parts = [p for p in Path(raw).parts if p not in {".", ""}]
    if len(parts) >= 2 and parts[0] == IMAGINE_DIRNAME:
        candidate = Path(project_path).joinpath(*parts)
        if candidate.is_file() and is_markup_path(project_path, candidate):
            return candidate
        return None
    if len(parts) >= 2 and parts[0] == REFERENCE_DIRNAME:
        candidate = Path(project_path).joinpath(*parts)
        if candidate.is_file() and is_markup_path(project_path, candidate):
            return candidate
        return None
    if parts and parts[0] in REFERENCE_SUBFOLDERS:
        candidate = Path(project_path).joinpath(REFERENCE_DIRNAME, *parts)
        if candidate.is_file() and is_markup_path(project_path, candidate):
            return candidate
        if len(parts) == 2 and candidate.is_file():
            return candidate
        return None

    if len(parts) == 2 and parts[0] in ENGINE_FOLDER_SET:
        candidate = Path(project_path) / parts[0] / parts[1]
        if candidate.is_file():
            return path_as_dirent(candidate)
        suf = Path(parts[1]).suffix.lower()
        if suf:
            found = _find_cad_file_in_dir(Path(project_path) / parts[0], Path(parts[1]).stem, {suf})
            if found is not None:
                return found
        return None

    layout_hit = resolve_in_layout(project_path, raw)
    if layout_hit is not None:
        return layout_hit

    safe = Path(raw).name
    if not safe or safe in {".", ".."}:
        return None
    root = Path(project_path) / safe
    if root.is_file():
        return path_as_dirent(root)
    lib = Path(project_path) / MCMASTER_LIBRARY_DIRNAME / safe
    if lib.is_file():
        return path_as_dirent(lib)
    ref = Path(project_path) / REFERENCE_DIRNAME / safe
    if ref.is_file():
        return path_as_dirent(ref)
    for sub in sorted(REFERENCE_SUBFOLDERS):
        nested = Path(project_path) / REFERENCE_DIRNAME / sub / safe
        if nested.is_file():
            return path_as_dirent(nested)
    render = Path(project_path) / RENDERS_DIRNAME / safe
    if render.is_file():
        return path_as_dirent(render)
    imagine = Path(project_path) / IMAGINE_DIRNAME / safe
    if imagine.is_file():
        return path_as_dirent(imagine)
    fetched = Path(project_path) / IMAGINE_DIRNAME / IMAGINE_FETCHED_DIRNAME / safe
    if fetched.is_file():
        return path_as_dirent(fetched)
    suf = Path(safe).suffix.lower()
    if suf:
        found = _find_cad_file_in_dir(Path(project_path), Path(safe).stem, {suf})
        if found is not None:
            return found
    return None


def markup_sidecar_path(file_path: Path) -> Path:
    return file_path.with_name(f"{file_path.name}.markup.json")


def can_write_reference_sidecar(project_path: Path, file_path: Path) -> bool:
    """Sidecar writes for markup paths, plus audio anywhere in the project."""
    if file_path is None:
        return False
    if is_markup_path(project_path, file_path):
        return True
    return Path(file_path).suffix.lower() in REFERENCE_AUDIO_SUFFIXES


def _empty_reference_markup() -> dict[str, Any]:
    return {"notes": "", "strokes": [], "comments": [], "waveform_peaks": [], "updated_at": None}


def _sanitize_file_comments(raw: Any) -> list[dict[str, Any]]:
    from backend.services import share_mode

    return share_mode.list_share_comments({"comments": raw if isinstance(raw, list) else []})


def _sanitize_waveform_peaks(raw: Any) -> list[float]:
    if not isinstance(raw, list):
        return []
    out: list[float] = []
    for value in raw[:320]:
        try:
            out.append(max(0.0, min(1.0, float(value))))
        except (TypeError, ValueError):
            continue
    return out if len(out) >= 2 else []


def load_reference_markup(file_path: Path) -> dict[str, Any]:
    side = markup_sidecar_path(file_path)
    if not side.is_file():
        return _empty_reference_markup()
    try:
        data = json.loads(side.read_text(encoding="utf-8"))
    except Exception:
        return _empty_reference_markup()
    if not isinstance(data, dict):
        return _empty_reference_markup()
    strokes = data.get("strokes") if isinstance(data.get("strokes"), list) else []
    return {
        "notes": str(data.get("notes") or ""),
        "strokes": strokes,
        "comments": _sanitize_file_comments(data.get("comments")),
        "waveform_peaks": _sanitize_waveform_peaks(data.get("waveform_peaks")),
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
    existing = load_reference_markup(file_path)
    payload = payload or {}
    if "comments" in payload:
        comments = _sanitize_file_comments(payload.get("comments"))
    else:
        comments = existing.get("comments") or []
    if "waveform_peaks" in payload:
        peaks = _sanitize_waveform_peaks(payload.get("waveform_peaks"))
    else:
        peaks = existing.get("waveform_peaks") or []
    out = {
        "notes": notes[:100_000],
        "strokes": cleaned,
        "comments": comments,
        "waveform_peaks": peaks,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    side = markup_sidecar_path(file_path)
    side.write_text(json.dumps(out, indent=2), encoding="utf-8")
    return out


def add_reference_file_comment(
    file_path: Path,
    *,
    text: str,
    t: float | None = None,
    author: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    from backend.services import share_mode

    current = load_reference_markup(file_path)
    bucket = {"comments": list(current.get("comments") or [])}
    comment = share_mode.add_share_comment(
        bucket,
        text=text,
        t=t,
        author=author or {},
    )
    saved = save_reference_markup(
        file_path,
        {
            "notes": current.get("notes") or "",
            "strokes": current.get("strokes") or [],
            "comments": bucket["comments"],
            "waveform_peaks": current.get("waveform_peaks") or [],
        },
    )
    return comment, saved.get("comments") or []


def list_reference_files(project_path: Path) -> list[dict[str, Any]]:
    from backend.services.parts_workspace import reference_entries
    refs: list[dict[str, Any]] = reference_entries(project_path)
    ref_root = Path(project_path) / REFERENCE_DIRNAME
    if not ref_root.is_dir():
        return refs

    def _append_file(f: Path, *, folder: str | None = None, require_supported: bool = True) -> None:
        if not f.is_file():
            return
        if f.name.endswith(".markup.json"):
            return
        if is_per_part_mcmaster_markdown(f.name):
            return
        suffix = f.suffix.lower()
        code_named = f.name in {"Dockerfile", "Makefile", "CMakeLists.txt", "Gemfile", "Pipfile", "requirements.txt"}
        if require_supported and suffix not in SUPPORTED_REFERENCE and not code_named:
            return
        rel_url = f"references/{folder}/{f.name}" if folder else f"references/{f.name}"
        label = f.name
        if folder == REFERENCE_MCMASTER_DIRNAME and f.name.lower() == MCMASTER_PARTS_LIST_FILENAME.lower():
            label = "Parts list"
        try:
            st = f.stat()
            size = st.st_size
            mtime = st.st_mtime
        except OSError:
            size = 0
            mtime = 0.0
        refs.append(
            {
                "id": f"{folder}:{f.stem}" if folder else f.stem,
                "name": f.name,
                "stem": f.stem,
                "format": f.suffix.lower().lstrip("."),
                "kind": reference_kind(f.name),
                "size": size,
                "mtime": mtime,
                "url": rel_url,
                "folder": folder,
                "label": label,
            }
        )

    for f in sorted(ref_root.iterdir(), key=lambda p: p.name.lower()):
        if f.is_file():
            _append_file(f)
            continue
        if f.is_dir() and f.name in REFERENCE_SUBFOLDERS:
            capture_folder = f.name in {
                REFERENCE_AR_DIRNAME,
                REFERENCE_RECORDINGS_DIRNAME,
                REFERENCE_SCREEN_RECORDINGS_DIRNAME,
                REFERENCE_SCREENSHOTS_DIRNAME,
                REFERENCE_VIDEO_EDITOR_DIRNAME,
            }
            children = list(f.iterdir())
            if f.name == REFERENCE_CANVAS_DIRNAME:
                children.sort(
                    key=lambda p: p.stat().st_mtime if p.exists() else 0.0,
                    reverse=True,
                )
            elif capture_folder:
                children.sort(
                    key=lambda p: p.stat().st_mtime if p.is_file() else 0.0,
                    reverse=True,
                )
            else:
                children.sort(key=lambda p: p.name.lower())
            for child in children:
                if child.is_file():
                    if f.name == REFERENCE_VIDEO_EDITOR_DIRNAME:
                        # Only project folders belong here — skip leftover copied clips.
                        continue
                    _append_file(child, folder=f.name)
                    continue
                if f.name == REFERENCE_CODE_DIRNAME:
                    if child.is_file():
                        _append_file(child, folder=f.name, require_supported=False)
                        continue
                    if child.is_dir() and child.name not in {".git", ".svn", "node_modules", "__pycache__", ".venv", "venv", "__MACOSX"}:
                        for dirpath, dirs, names in os.walk(child, followlinks=False):
                            dirs[:] = sorted(
                                d for d in dirs
                                if d not in {".git", ".svn", "node_modules", "__pycache__", ".venv", "venv", "__MACOSX"}
                                and not (Path(dirpath) / d).is_symlink()
                            )
                            rel_parent = Path(dirpath).relative_to(f)
                            folder = f"{f.name}/{rel_parent.as_posix()}" if rel_parent.parts else f.name
                            for name in sorted(names):
                                leaf = Path(dirpath) / name
                                if leaf.is_symlink() or name == ".DS_Store":
                                    continue
                                _append_file(leaf, folder=folder, require_supported=False)
                        continue
                if f.name == REFERENCE_IMPROVE_LAB_DIRNAME and child.is_dir():
                    nested = sorted(child.iterdir(), key=lambda p: p.name.lower())
                    for leaf in nested:
                        if leaf.is_file():
                            _append_file(leaf, folder=f"{f.name}/{child.name}")
                        elif leaf.is_dir():
                            for nested_file in leaf.iterdir():
                                if nested_file.is_file():
                                    _append_file(nested_file, folder=f"{f.name}/{child.name}/{leaf.name}")
                    continue
                if f.name == REFERENCE_VIDEO_EDITOR_DIRNAME and child.is_dir():
                    store_folder = f"{f.name}/{child.name}"
                    meta_path = child / VIDEO_EDITOR_META_FILENAME
                    meta = _read_video_editor_meta(meta_path)
                    if meta_path.is_file():
                        _append_file(meta_path, folder=store_folder)
                    if (child / VIDEO_EDITOR_THUMB_FILENAME).is_file():
                        _append_file(child / VIDEO_EDITOR_THUMB_FILENAME, folder=store_folder)
                    for leaf in child.iterdir():
                        if not leaf.is_file() or leaf.name in VIDEO_EDITOR_SKIP_FILES:
                            continue
                        if leaf.suffix.lower() in {".mp4", ".webm", ".mov", ".m4v"}:
                            continue
                        _append_file(leaf, folder=store_folder)
                    for ref in merge_video_editor_source_refs(meta.get("sources"), None):
                        src = resolve_project_file(project_path, ref["path"])
                        size = 0
                        mtime = 0.0
                        if src is not None and src.is_file():
                            try:
                                st = src.stat()
                                size = st.st_size
                                mtime = st.st_mtime
                            except OSError:
                                pass
                        url = f"references/{ref['path']}"
                        refs.append(
                            {
                                "id": f"{store_folder}:{Path(ref['name']).stem}",
                                "name": ref["name"],
                                "stem": Path(ref["name"]).stem,
                                "format": Path(ref["name"]).suffix.lower().lstrip("."),
                                "kind": ref["kind"],
                                "size": size,
                                "mtime": mtime,
                                "url": url,
                                "folder": store_folder,
                                "label": ref["name"],
                                "filename": ref["path"],
                                "source_path": ref["path"],
                                "path_ref": True,
                            }
                        )
                    continue
                if f.name == REFERENCE_CANVAS_DIRNAME and child.is_dir():
                    leaves = [p for p in child.iterdir() if p.is_file()]
                    leaves.sort(
                        key=lambda p: p.stat().st_mtime if p.exists() else 0.0,
                        reverse=True,
                    )
                    for leaf in leaves:
                        _append_file(leaf, folder=f"{f.name}/{child.name}")
    return refs


def list_render_files(project_path: Path) -> list[dict[str, Any]]:
    """Photoreal scene renders saved under project/renders/."""
    items: list[dict[str, Any]] = []
    root = Path(project_path) / RENDERS_DIRNAME
    if not root.is_dir():
        return items
    image_suffixes = REFERENCE_IMAGE_SUFFIXES | {".png", ".jpg", ".jpeg", ".webp"}
    files = []
    for f in root.iterdir():
        if not f.is_file():
            continue
        if f.name.endswith(".markup.json"):
            continue
        if f.suffix.lower() not in image_suffixes:
            continue
        try:
            st = f.stat()
        except OSError:
            continue
        files.append((st.st_mtime, f, st.st_size))
    files.sort(key=lambda row: row[0], reverse=True)
    for mtime, f, size in files:
        items.append(
            {
                "id": f.stem,
                "name": f.name,
                "stem": f.stem,
                "format": f.suffix.lower().lstrip("."),
                "kind": "image",
                "size": size,
                "mtime": mtime,
                "url": f"renders/{f.name}",
                "section": "renders",
            }
        )
    return items


def form_yes(value) -> bool:
    return isinstance(value, str) and value.strip().lower() in {"1", "true", "yes"}


def is_electronics_build_sourcing_name(filename: str) -> bool:
    path = Path(Path(str(filename or "")).name)
    if path.suffix.lower() != ".md":
        return False
    stem = re.sub(r"[\s_-]+", "_", path.stem.strip().lower())
    return re.fullmatch(r"electronics_build_sourcing(?:_\d+)?", stem) is not None


def reference_upload_destination(
    project_path: Path,
    filename: str,
    *,
    folder: str | None = None,
    replace: bool = False,
) -> Path:
    """Where a reference upload lands.

    Electronics sourcing notes are one live document. Re-saving them must update
    that file, not mint electronics_build_sourcing_2.md, _3.md, and so on.
    """
    safe = Path(str(filename or "")).name or "reference.bin"
    lower = safe.lower()
    folder_name = canonical_reference_folder(folder) or ""
    live_sourcing = is_electronics_build_sourcing_name(safe)
    wiring_note = (
        replace
        and folder_name == REFERENCE_ELECTRONICS_DIRNAME
        and lower.endswith(".md")
        and lower.startswith("electronics_")
        and ".." not in safe
    )
    if live_sourcing or wiring_note:
        if live_sourcing:
            safe = "electronics_build_sourcing.md"
        return reference_subdir(project_path, folder) / safe
    return unique_reference_path(project_path, safe, folder=folder)


def remove_legacy_electronics_sourcing_references(
    project_path: Path,
    *,
    folder: str | None,
    keep: Path,
) -> list[Path]:
    if canonical_reference_folder(folder) != REFERENCE_ELECTRONICS_DIRNAME:
        return []
    directory = reference_subdir(project_path, folder)
    keep_path = Path(keep)
    removed: list[Path] = []
    for path in directory.iterdir():
        if path == keep_path or not path.is_file():
            continue
        if not is_electronics_build_sourcing_name(path.name):
            continue
        path.unlink()
        removed.append(path)
    return removed


def unique_reference_path(
    project_path: Path,
    filename: str,
    *,
    folder: str | None = None,
) -> Path:
    dest_dir = reference_subdir(project_path, folder)
    safe = Path(filename).name or "reference.bin"
    dest = dest_dir / safe
    # Also avoid colliding with the same basename in references/ root or AR/.
    def _taken(path: Path) -> bool:
        if path.exists():
            return True
        return resolve_project_file(project_path, path.name) is not None

    if not _taken(dest):
        return dest
    stem = dest.stem
    suffix = dest.suffix
    clock_stem = bool(
        re.match(
            r"^recording \d{1,2}:\d{2} (?:AM|PM) \d{2}\.\d{2}\.\d{2}$",
            stem,
            flags=re.IGNORECASE,
        )
    )
    n = 2
    while True:
        candidate = dest_dir / (f"{stem} ({n}){suffix}" if clock_stem else f"{stem}_{n}{suffix}")
        if not _taken(candidate):
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
    if src is None or not is_markup_path(project_path, src):
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
    if src is None or not is_markup_path(project_path, src):
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
    if name.startswith("_active_") or name.startswith("_export_") or name.startswith("_share_"):
        return True
    if _is_internal_dxf_sidecar(name):
        return True
    if lower.endswith((".program.json", ".sketch.json", ".sim.json", ".mjcf.xml", ".urdf", ".srdf")):
        return True
    if "_snapshot" in lower:
        return True
    return False


def _catalog_tombstone_keys(name: str) -> set[str]:
    """Rel path, basename, and stem keys used to hide a deleted component on reload."""
    from backend.services.engine_layout import normalize_rel

    raw = normalize_rel(name) or str(name or "").replace("\\", "/").strip()
    if not raw:
        return set()
    base = Path(raw).name
    stem = Path(base).stem
    keys = {raw.lower(), base.lower()}
    if stem:
        keys.add(stem.lower())
    return {k for k in keys if k}


def catalog_is_deleted(name: str, deleted: set[str] | list[str] | None) -> bool:
    if not name or not deleted:
        return False
    blocked = {str(item).lower() for item in deleted if item}
    if not blocked:
        return False
    return bool(_catalog_tombstone_keys(name) & blocked)


def load_deleted_catalogs(project_path: Path) -> list[str]:
    from backend.services import project_store

    meta = project_store.load_meta(project_path)
    raw = meta.get("deleted_catalogs")
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in raw:
        value = str(item or "").replace("\\", "/").strip()
        if not value or value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


def add_deleted_catalogs(project_path: Path, names: list[str] | tuple[str, ...] | set[str]) -> list[str]:
    from backend.services import project_store

    meta = project_store.load_meta(project_path)
    current = load_deleted_catalogs(project_path)
    seen = {item.lower() for item in current}
    for name in names:
        for key in _catalog_tombstone_keys(str(name or "")):
            if key in seen:
                continue
            current.append(key)
            seen.add(key)
    meta["deleted_catalogs"] = current
    project_store.save_meta(project_path, meta)
    return current


def clear_deleted_catalogs(project_path: Path, names: list[str] | tuple[str, ...] | set[str]) -> list[str]:
    from backend.services import project_store

    drop = set()
    for name in names:
        drop |= _catalog_tombstone_keys(str(name or ""))
    if not drop:
        return load_deleted_catalogs(project_path)
    meta = project_store.load_meta(project_path)
    kept = [item for item in load_deleted_catalogs(project_path) if item.lower() not in drop]
    meta["deleted_catalogs"] = kept
    project_store.save_meta(project_path, meta)
    return kept


def clear_deleted_catalogs_for_published(project_path: Path, names: list[str] | tuple[str, ...] | set[str]) -> list[str]:
    """Unhide a component after CAD republishes it (delete tombstones must not stick)."""
    expanded: list[str] = []
    for name in names:
        raw = str(name or "").replace("\\", "/").strip()
        if not raw:
            continue
        expanded.append(raw)
        stem = Path(raw).stem
        if not stem:
            continue
        for suffix in (".glb", ".gltf", ".step", ".stp", ".py"):
            expanded.append(stem + suffix)
    return clear_deleted_catalogs(project_path, expanded)


def _existing_tombstoned_assembly_rels(project_path: Path, deleted: set[str] | list[str] | None) -> list[str]:
    """Assembly GLBs still on disk that a delete-tombstone is hiding."""
    from backend.services.engine_layout import iter_design_files, project_rel

    if not deleted:
        return []
    existing: list[str] = []
    seen: set[str] = set()
    for path in iter_design_files(project_path):
        if not path.is_file():
            continue
        if path.suffix.lower() not in {".glb", ".gltf"}:
            continue
        lower = path.name.lower()
        if (
            path.name.startswith(".")
            or path.name.startswith("_")
            or "__part_" in lower
            or "__faceted" in lower
            or ".generation-live." in lower
            or looks_like_mcmaster_part_stem(path.stem)
        ):
            continue
        rel = project_rel(project_path, path)
        if not (catalog_is_deleted(rel, deleted) or catalog_is_deleted(path.name, deleted)):
            continue
        if rel in seen:
            continue
        seen.add(rel)
        existing.append(rel)
    return existing


def _has_visible_designed_assembly(project_path: Path, deleted: set[str] | list[str] | None) -> bool:
    from backend.services.engine_layout import iter_design_files, project_rel

    for path in iter_design_files(project_path):
        if not path.is_file():
            continue
        if path.suffix.lower() not in {".glb", ".gltf", ".step", ".stp", ".stl", ".3mf"}:
            continue
        lower = path.name.lower()
        if (
            path.name.startswith(".")
            or path.name.startswith("_")
            or "__part_" in lower
            or "__faceted" in lower
            or ".generation-live." in lower
            or looks_like_mcmaster_part_stem(path.stem)
        ):
            continue
        rel = project_rel(project_path, path)
        if catalog_is_deleted(rel, deleted) or catalog_is_deleted(path.name, deleted):
            continue
        return True
    return False


def revive_tombstoned_assemblies_if_viewport_empty(project_path: Path) -> list[str]:
    """Unhide restored assembly GLBs when a copy/tombstone left the viewport empty.

    Delete still hides a model when another designed file remains visible. When the
    only assembly is tombstoned but the GLB is still on disk (project copy, or a
    later write that skipped publish), bring it back so rig generate cannot blank
    the viewport.
    """
    deleted = load_deleted_catalogs(project_path)
    if not deleted:
        return []
    if _has_visible_designed_assembly(project_path, deleted):
        return []
    existing = _existing_tombstoned_assembly_rels(project_path, deleted)
    if not existing:
        return []
    return clear_deleted_catalogs_for_published(project_path, existing)


def collapse_duplicate_folder_stems(components: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One Component when the same assembly exists at project root and in vibecad/."""
    rows = [c for c in (components or []) if isinstance(c, dict)]
    by_stem: dict[str, list[dict[str, Any]]] = {}
    rest: list[dict[str, Any]] = []
    for comp in rows:
        stem = str(comp.get("stem") or "").strip()
        if not stem:
            rest.append(comp)
            continue
        by_stem.setdefault(stem.lower(), []).append(comp)
    out = list(rest)
    for group in by_stem.values():
        if len(group) == 1:
            out.append(group[0])
            continue
        out.append(max(group, key=lambda c: (1 if c.get("engine") else 0, int(c.get("size") or 0))))
    return out


def list_project_files(project_path: Path) -> list[dict[str, Any]]:
    from backend.services.engine_layout import engine_folder_of, iter_design_files, project_rel

    files = []
    listed = SUPPORTED_IMPORT | SUPPORTED_EXPORT | SUPPORTED_ROBOT
    revive_tombstoned_assemblies_if_viewport_empty(project_path)
    deleted = set(load_deleted_catalogs(project_path))
    for f in sorted(iter_design_files(project_path), key=lambda p: p.as_posix().lower()):
        if not f.is_file():
            continue
        if f.name.startswith("."):
            continue
        # Mesh-mode Three.js factories sit beside the exported GLB; include them so
        # the viewport can detect authored/shaded style on reopen.
        is_mesh_factory = f.name.lower().endswith(".mesh.mjs") or f.name.lower().endswith(".mesh.js")
        if f.suffix.lower() not in listed and not is_mesh_factory:
            continue
        if (
            f.name.startswith("_active_")
            or f.name.startswith("_export_")
            or f.name.startswith("_share_")
            or _is_internal_dxf_sidecar(f.name)
        ):
            continue
        if ".generation-live." in f.name.lower():
            continue
        rel = project_rel(project_path, f)
        if catalog_is_deleted(rel, deleted) or catalog_is_deleted(f.name, deleted):
            continue
        engine = engine_folder_of(rel)
        stat = f.stat()
        files.append(
            {
                "id": Path(rel).with_suffix("").as_posix(),
                "name": rel,
                "format": "mesh" if is_mesh_factory else f.suffix.lower().lstrip("."),
                "size": stat.st_size,
                "version": f"{stat.st_mtime_ns}-{stat.st_size}",
                "engine": engine,
            }
        )
    return files


_PUBLISH_MODEL_RANK = {".glb": 4, ".gltf": 3, ".step": 2, ".stp": 2}


def newest_published_model(project_path: Path) -> str | None:
    """Newest published design model, including jake/ vibecad/ mesh/ folders.

    Skips live generation previews, snapshots, and catalog hardware. Used when a
    later Mesh/Jake/VibeCAD publish is newer than the timeline's current file.
    """
    from backend.services.engine_layout import iter_design_files, project_rel

    deleted = set(load_deleted_catalogs(project_path))
    best: tuple[float, int, str] | None = None
    for path in iter_design_files(project_path):
        if not path.is_file():
            continue
        name = path.name
        lower = name.lower()
        if name.startswith("_active_") or name.startswith("_export_") or name.startswith("_share_"):
            continue
        if ".generation-live." in lower or "_snapshot" in lower:
            continue
        if "__part_" in lower or "__faceted" in lower:
            continue
        rel = project_rel(project_path, path)
        if catalog_is_deleted(rel, deleted) or catalog_is_deleted(name, deleted):
            continue
        rank = _PUBLISH_MODEL_RANK.get(path.suffix.lower())
        if rank is None:
            continue
        if looks_like_mcmaster_part_stem(path.stem):
            continue
        if looks_like_drive_id_stub(path):
            continue
        if looks_like_create_primitive_stem(path.stem) and (
            (project_path / f"{path.stem}.freecad.json").is_file()
            or (project_path / f"{path.stem}.freecad.py").is_file()
        ):
            continue
        if _is_exploded_assembly_sidecar_stem(path.stem, project_path):
            continue
        rel = project_rel(project_path, path)
        try:
            mtime = path.stat().st_mtime
        except OSError:
            continue
        key = (mtime, rank, rel)
        if best is None or key > best:
            best = key
    return best[2] if best else None


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


def step_has_assembly_links(path: Path | str, *, max_bytes: int = 8_000_000) -> bool:
    """True when STEP has NEXT_ASSEMBLY_USAGE (Fusion opens as linked assembly → Cut fails)."""
    p = Path(path)
    if not p.is_file():
        return False
    try:
        text = p.read_bytes()[:max_bytes].decode("utf-8", errors="ignore").upper()
    except OSError:
        return False
    return "NEXT_ASSEMBLY_USAGE" in text


def sanitize_fusion_part_stem(stem: str) -> str:
    """Cloud/XCAF stem for Fusion Part uploads — strip Assembly wording, end with ``_Part``.

    Fusion keeps document type sticky on an item. Versioning ``Parametric_Assembly_Of_….step``
    with Part bytes still opens as a linked Assembly insert → Extrude Cut fails with
    "No target body found to cut or intersect!". A fresh ``…_Part.step`` item opens as Part.
    """
    raw = Path(str(stem or "Part")).name
    if raw.lower().endswith((".step", ".stp")):
        raw = Path(raw).stem
    for suffix in (".fusionpart", ".part"):
        if raw.lower().endswith(suffix):
            raw = raw[: -len(suffix)]
            break
    s = str(raw or "Part")
    s = re.sub(r"(?i)parametric[_\s-]*step[_\s-]*", "", s)
    s = re.sub(r"(?i)parametric[_\s-]*cad[_\s-]*", "", s)
    s = re.sub(r"(?i)parametric[_\s-]*", "", s)
    s = re.sub(r"(?i)multi[_\s-]*body[_\s-]*", "", s)
    s = re.sub(r"(?i)assembl(?:y|ies)[_\s-]*of[_\s-]*", "", s)
    s = re.sub(r"(?i)[_\s-]*assembl(?:y|ies)[_\s-]*", "_", s)
    s = re.sub(r"(?i)^new_", "", s)
    s = re.sub(r"[^\w\-]+", "_", s)
    s = re.sub(r"_+", "_", s).strip("_") or "RenderStudio_Model"
    s = s[:72]
    if not re.search(r"(?i)_part$", s):
        s = f"{s}_Part"
    return s


def fusion_part_cloud_filename(stem: str) -> str:
    """Filename Fusion Data Panel should show for Extrude/Cut-ready Part pushes."""
    return f"{sanitize_fusion_part_stem(stem)}.step"


def ensure_fusion_part_step(project_path: Path, step_path: Path) -> Path:
    """Return a Part-style STEP (no assembly links) suitable for Extrude/Cut.

    Regenerates ``*.part.step`` when missing, stale (older than native), or still
    linked. Never reuse a stale Part cache — that broke Fusion Cut / wrong solids.
    """
    project_path = Path(project_path)
    step_path = Path(step_path)
    if not step_path.is_file():
        return step_path
    stem = step_path.stem
    for suffix in (".fusionpart", ".part"):
        if stem.endswith(suffix):
            stem = stem[: -len(suffix)]
            break
    # Prefer native sibling as the flatten source (not a prior .part.step).
    native = step_path
    if step_path.name.lower().endswith(".part.step") or ".fusionpart." in step_path.name.lower():
        for ext in (".step", ".stp"):
            cand = project_path / f"{stem}{ext}"
            if cand.is_file() and is_editable_brep_step(cand):
                native = cand
                break
    else:
        for ext in (".step", ".stp"):
            cand = project_path / f"{stem}{ext}"
            if cand.is_file() and is_editable_brep_step(cand):
                native = cand
                break
    part_path = project_path / f"{stem}.part.step"

    try:
        from backend.services.cad_harness import project_has_harness_joints

        if project_has_harness_joints(project_path, stem=stem):
            # Preserve component identities for native joint importers.
            return native
    except Exception:
        pass

    def _part_fresh() -> bool:
        if not part_path.is_file():
            return False
        if not is_editable_brep_step(part_path):
            return False
        if step_has_assembly_links(part_path):
            return False
        try:
            if native.is_file() and part_path.stat().st_mtime + 0.01 < native.stat().st_mtime:
                return False
        except OSError:
            return False
        return True

    if _part_fresh():
        return part_path

    # Already a single Part with no links — copy/cache and return.
    if native.is_file() and not step_has_assembly_links(native) and is_editable_brep_step(native):
        if native.resolve() != part_path.resolve():
            try:
                import shutil

                shutil.copy2(native, part_path)
            except Exception:
                return native
        return part_path if part_path.is_file() else native

    try:
        return export_step_as_single_part(native, part_path)
    except Exception:
        alt = project_path / f"{stem}.fusionpart.step"
        return export_step_as_single_part(native, alt)


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
    for suffix in (".fusionpart", ".part"):
        if stem.lower().endswith(suffix):
            stem = stem[: -len(suffix)]
            break
    candidates: list[Path] = []
    # Prefer the native `{stem}.step` over any `*.part.step` cache the UI requested.
    for ext in STEP_SUFFIXES:
        native = project_path / f"{stem}{ext}"
        if native.is_file():
            candidates.append(native)
    if Path(safe).suffix.lower() in STEP_SUFFIXES:
        candidates.append(project_path / safe)
    step_src = find_step_source(project_path, stem)
    if step_src is not None:
        candidates.append(step_src)
    base_variants = _native_brep_parent_stems(stem)
    for base in list(base_variants):
        if base.startswith("."):
            base_variants.append(base[1:])
    for variant in list(base_variants):
        if variant.lower().endswith((".step", ".stp")):
            base_variants.append(Path(variant).stem)
    for variant in dict.fromkeys(v for v in base_variants if v and v != stem):
        variant_step = find_step_source(project_path, variant)
        if variant_step is not None:
            candidates.append(variant_step)

    def _native_score(path: Path) -> int:
        name = path.name.lower()
        score = 0
        if is_editable_brep_step(path):
            score += 10
        if ".part." in name or ".fusionpart." in name:
            score -= 20
        if "__faceted" in name:
            score -= 30
        return score

    seen: set[str] = set()
    editable: list[Path] = []
    for path in candidates:
        key = str(path.resolve()) if path.exists() else path.name
        if key in seen:
            continue
        seen.add(key)
        if path.is_file() and is_editable_brep_step(path):
            editable.append(path)
    if editable:
        return max(editable, key=_native_score)
    return None


def resolve_existing_project_file(project_path: Path, filename: str | None) -> str | None:
    """Resolve a project model path, including edited/exploded variants.

    Export/share UIs often keep the pre-explode stem (e.g. ``foo.step``) after
    generation wrote ``foo_exploded.step``. Prefer an exact hit, then common
    variant suffixes, then a safe prefix match under the project folder.
    """
    if not filename:
        return None
    from backend.services.engine_layout import project_rel, resolve_in_layout

    layout_hit = resolve_in_layout(project_path, filename) or resolve_project_file(project_path, filename)
    if layout_hit is not None and layout_hit.is_file():
        return project_rel(project_path, path_as_dirent(layout_hit))
    safe = Path(str(filename)).name
    if not safe or safe in {".", ".."}:
        return None
    direct = project_path / safe
    if direct.is_file():
        return path_as_dirent(direct).name

    stem = Path(safe).stem
    requested_ext = Path(safe).suffix.lower()
    root = stem
    for suffix in ("_edited", "_pulled", "_mirrored", "_extruded", "_body", "_exploded"):
        if root.endswith(suffix):
            root = root[: -len(suffix)]
            break

    preferred_exts = (
        ".step",
        ".stp",
        ".glb",
        ".gltf",
        ".stl",
        ".3mf",
        ".obj",
        ".ply",
        ".off",
    )
    exts: list[str] = []
    if requested_ext:
        exts.append(requested_ext)
    for ext in preferred_exts:
        if ext not in exts:
            exts.append(ext)

    candidate_stems: list[str] = []
    for value in (stem, root, f"{stem}_exploded", f"{root}_exploded"):
        if value and value not in candidate_stems:
            candidate_stems.append(value)

    # Match the requested suffix across stems first. Asking for
    # ``foo_edited.step`` must not return ``foo_edited.glb`` before the
    # catalog ``foo.step`` that can still be transformed for export.
    search_ext_groups = [exts]
    if requested_ext:
        search_ext_groups = [[requested_ext], [ext for ext in exts if ext != requested_ext]]
    for group in search_ext_groups:
        for candidate_stem in candidate_stems:
            for ext in group:
                path = project_path / f"{candidate_stem}{ext}"
                if path.is_file():
                    return path_as_dirent(path).name

    matches: list[Path] = []
    for ext in exts:
        matches.extend(
            path
            for path in project_path.glob(f"{root}*{ext}")
            if path.is_file() and not path.name.startswith(".") and not path.name.startswith("_active_")
        )
    if requested_ext:
        found = find_cad_file_for_stem(project_path, stem, {requested_ext})
        if found is not None and found.is_file():
            return project_rel(project_path, path_as_dirent(found))
    if not matches:
        return None
    matches.sort(
        key=lambda path: (
            0 if path.suffix.lower() == requested_ext else 1,
            0 if path.stem == stem else 1,
            0 if path.stem.endswith("_exploded") else 1,
            len(path.name),
            path.name.lower(),
        )
    )
    return path_as_dirent(matches[0]).name


def _model_source_and_export_dirs(project_path: Path, filename: str) -> tuple[Path | None, list[Path]]:
    """Source file plus directories that hold its downloadable siblings.

    Nested jake/vibecad/mesh models store GLB/STL/STEP next to the source, not
    only at project root.
    """
    from backend.services.engine_layout import resolve_in_layout

    project_path = Path(project_path)
    src = resolve_in_layout(project_path, filename) or resolve_project_file(project_path, filename)
    dirs: list[Path] = []
    seen: set[str] = set()
    for folder in ((src.parent,) if src is not None else ()) + (project_path,):
        try:
            key = str(folder.resolve())
        except OSError:
            key = str(folder)
        if key in seen or not folder.is_dir():
            continue
        seen.add(key)
        dirs.append(folder)
    return (src if src is not None and src.is_file() else None), dirs


def derived_export_source(project_path: Path, filename: str) -> Path | None:
    """Assembled GLB (then other mesh, then STEP) to build STL/3MF/OBJ from.

    Generate writes STEP + assembled GLB. Print formats are export-on-demand.
    """
    project_path = Path(project_path)
    raw = str(filename or "").replace("\\", "/").strip()
    if not raw:
        return None
    requested_suffix = Path(raw).suffix.lower()
    leaf = Path(raw).name
    stem = Path(leaf).stem
    orig_stem = stem
    for suffix in (".fusionpart", ".part"):
        if stem.lower().endswith(suffix):
            stem = stem[: -len(suffix)]
            break
    want_exploded = orig_stem.lower().endswith("_exploded")
    _src, search_dirs = _model_source_and_export_dirs(project_path, raw)

    def _usable(path: Path | None) -> Path | None:
        if path is None or not path.is_file():
            return None
        suf = path.suffix.lower()
        if suf not in set(_DERIVED_MESH_SOURCE_SUFFIXES) | STEP_SUFFIXES:
            return None
        if suf == requested_suffix and requested_suffix in {f".{fmt}" for fmt in ON_DEMAND_MESH_EXPORTS}:
            return None
        if not want_exploded and path.stem.lower().endswith("_exploded"):
            return None
        return path

    stems = [orig_stem]
    if stem != orig_stem:
        stems.append(stem)
    for suffixes in (_DERIVED_MESH_SOURCE_SUFFIXES, tuple(STEP_SUFFIXES)):
        for folder in search_dirs:
            for candidate_stem in stems:
                for suf in suffixes:
                    hit = _usable(folder / f"{candidate_stem}{suf}")
                    if hit is not None:
                        return hit
        for candidate_stem in stems:
            hit = _usable(find_cad_file_for_stem(project_path, candidate_stem, set(suffixes)))
            if hit is not None:
                return hit

    if _src is not None and _src.is_file():
        hit = _usable(_src)
        if hit is not None:
            return hit
        if _src.suffix.lower() in {".glb", ".gltf"} | STEP_SUFFIXES:
            if want_exploded or not _src.stem.lower().endswith("_exploded"):
                return _src
    return None


def ensure_derived_export(
    project_path: Path,
    filename: str,
    *,
    fmt: str | None = None,
    visible_body_indices: list[int] | None = None,
    force: bool = False,
) -> Path | None:
    """Write a missing STL/3MF/OBJ from STEP/GLB. Zip-deflates 3MF. Returns the path."""
    from backend.services.engine_layout import project_rel

    project_path = Path(project_path)
    raw = str(filename or "").replace("\\", "/").strip()
    fmt = (fmt or _export_format(raw) or "").lower()
    if fmt == "stp":
        fmt = "step"
    if fmt not in ON_DEMAND_MESH_EXPORTS:
        return None
    source = derived_export_source(project_path, raw)
    if source is None or not source.is_file():
        return None
    dest = source.parent / f"{source.stem}.{fmt}"
    src_mtime = source.stat().st_mtime
    must_rebuild = bool(force) or visible_body_indices is not None
    if dest.is_file() and not must_rebuild and not _export_is_stale(src_mtime, dest, fmt):
        return dest
    if fmt == "3mf":
        convert_mesh_to_3mf(
            project_path,
            project_rel(project_path, source),
            dest=dest,
            visible_body_indices=visible_body_indices,
        )
    else:
        export_mesh(load_mesh(source), dest)
    return dest if dest.is_file() else None


def list_exports_for_model(project_path: Path, filename: str) -> list[dict[str, Any]]:
    """List downloadable artifacts that share a model basename.

    Exposes at most **one** STEP — the native editable B-rep (Jul 16 path).
    Faceted siblings are not listed. Never rewrites through ensure_fusion_part_step.
    """
    from backend.services.engine_layout import project_rel

    project_path = Path(project_path)
    src, search_dirs = _model_source_and_export_dirs(project_path, filename)
    base_name = src.name if src is not None else Path(filename).name
    stem = Path(base_name).stem
    # Strip .part from stem so Fully_Assembled.part.step still lists siblings.
    root_stem = stem[:-5] if stem.endswith(".part") else stem
    if root_stem.endswith(".fusionpart"):
        root_stem = root_stem[: -len(".fusionpart")]
    exports: list[dict[str, Any]] = []
    seen_files: set[str] = set()
    faceted_name = faceted_step_name(root_stem)
    for folder in search_dirs:
        try:
            children = sorted(folder.iterdir())
        except OSError:
            continue
        for f in children:
            if not f.is_file() or f.name.startswith("_active_"):
                continue
            name = f.name
            if (
                name != base_name
                and name != Path(filename).name
                and not name.startswith(f"{root_stem}.")
                and not name.startswith(f"{stem}.")
                and name != faceted_name
                and name != f"{root_stem}.part.step"
            ):
                continue
            fmt = _export_format(name)
            if fmt == "step":
                # Collected below — never list raw/faceted STEPs here.
                continue
            rel = project_rel(project_path, f)
            if rel in seen_files:
                continue
            seen_files.add(rel)
            exports.append(
                {
                    "name": rel,
                    "format": fmt,
                    "size": f.stat().st_size,
                }
            )

    best_step = _fusion_ready_step_export(project_path, root_stem, filename)
    if best_step is not None:
        exports.append(best_step)

    formats = {str(item.get("format") or "").lower() for item in exports}
    source = derived_export_source(project_path, filename) or src
    if source is not None and source.is_file():
        for fmt in ON_DEMAND_MESH_EXPORTS:
            if fmt in formats:
                continue
            dest = source.parent / f"{source.stem}.{fmt}"
            exports.append(
                {
                    "name": project_rel(project_path, dest),
                    "format": fmt,
                    "size": dest.stat().st_size if dest.is_file() else 0,
                    "convertible": not dest.is_file(),
                }
            )
            formats.add(fmt)
    return exports


_EXPORT_FORMAT_LABELS = {
    "glb": "GLB",
    "gltf": "GLTF",
    "stl": "STL",
    "step": "STEP",
    "stp": "STEP",
    "3mf": "3MF",
    "obj": "OBJ",
    "ply": "PLY",
    "off": "OFF",
}


def export_format_label(filename: str) -> str:
    fmt = _export_format(filename)
    return _EXPORT_FORMAT_LABELS.get(fmt, (fmt or "file").upper() or "File")


def missing_export_reason(project_path: Path, filename: str) -> str:
    """Why a download path is missing — no STEP/GLB to convert from, or only other formats exist."""
    requested = str(filename or "").strip() or "file"
    label = export_format_label(requested)
    leaf = Path(requested).name
    fmt = _export_format(requested)
    source = derived_export_source(project_path, requested)
    if fmt in ON_DEMAND_MESH_EXPORTS:
        if source is None:
            return (
                f"{label} cannot be exported — this model has no STEP or GLB to convert from "
                f"({leaf})."
            )
        return f"{label} could not be generated from {source.name}."
    rel = resolve_existing_project_file(project_path, requested)
    lookup = rel or requested
    src, _dirs = _model_source_and_export_dirs(project_path, lookup)
    if src is None:
        found = find_cad_file_for_stem(
            project_path,
            Path(leaf).stem,
            {".glb", ".gltf", ".stl", ".step", ".stp", ".3mf", ".obj", ".ply", ".off"},
        )
        if found is not None and found.is_file():
            from backend.services.engine_layout import project_rel

            lookup = project_rel(project_path, found)
            src = found
    wrote: list[str] = []
    seen: set[str] = set()
    if src is not None or rel:
        for item in list_exports_for_model(project_path, lookup):
            if item.get("convertible") and not item.get("size"):
                continue
            fmt_label = _EXPORT_FORMAT_LABELS.get(
                str(item.get("format") or "").lower(),
                str(item.get("format") or "").upper(),
            )
            if fmt_label and fmt_label not in seen:
                seen.add(fmt_label)
                wrote.append(fmt_label)
    if not wrote and src is None:
        return (
            f"{label} is not on disk ({leaf}). No STEP or GLB was generated for this model."
        )
    if wrote and label not in wrote:
        why = ""
        if label == "STEP":
            why = " Native B-rep STEP was not produced — mesh-only generation does not write Fusion-editable STEP."
        return (
            f"{label} was never generated for this model. Generation wrote {', '.join(wrote)} only.{why}"
        )
    return f"{label} is not on disk ({leaf}). No STEP or GLB was generated for this model."


def _export_step_dest_for_model(project_path: Path, filename: str) -> Path:
    """Path of the STEP that belongs to this viewport file (not a catalog parent)."""
    src, _dirs = _model_source_and_export_dirs(project_path, filename)
    if src is not None and src.is_file():
        if src.suffix.lower() in STEP_SUFFIXES:
            return src if src.suffix.lower() == ".step" else src.with_name(f"{src.stem}.step")
        return src.with_suffix(".step")
    stem = Path(str(filename or "")).stem
    for suffix in (".fusionpart", ".part"):
        if stem.lower().endswith(suffix):
            stem = stem[: -len(suffix)]
            break
    return Path(project_path) / f"{stem}.step"


def _step_stem_matches_root(path: Path, root_stem: str) -> bool:
    stem = path.stem
    for suffix in (".fusionpart", ".part"):
        if stem.lower().endswith(suffix):
            stem = stem[: -len(suffix)]
            break
    return stem.lower() == str(root_stem or "").lower()


def _parent_brep_step_for_stem(project_path: Path, stem: str) -> Path | None:
    """Catalog / generative STEP that can be copied or kernel-transformed into *stem*."""
    exact = find_step_source(project_path, stem)
    if exact is not None and exact.is_file():
        return exact
    for variant in _native_brep_parent_stems(stem):
        if not variant or variant == stem:
            continue
        found = find_step_source(project_path, variant)
        if found is not None and found.is_file():
            return found
    return None


def _infer_mesh_delta_transform(src_mesh: Path, dst_mesh: Path) -> dict[str, Any] | None:
    """Recover gizmo translation/scale from an original mesh vs its ``_edited`` bake."""
    try:
        src = load_mesh(src_mesh)
        dst = load_mesh(dst_mesh)
    except Exception:
        return None
    src_bounds = getattr(src, "bounds", None)
    dst_bounds = getattr(dst, "bounds", None)
    if src_bounds is None or dst_bounds is None:
        return None
    src_c = np.asarray(src_bounds, dtype=float).mean(axis=0)
    dst_c = np.asarray(dst_bounds, dtype=float).mean(axis=0)
    src_e = np.asarray(getattr(src, "extents", np.ones(3)), dtype=float)
    dst_e = np.asarray(getattr(dst, "extents", np.ones(3)), dtype=float)
    transform: dict[str, Any] = {}
    if float(np.linalg.norm(dst_c - src_c)) > 1e-4:
        transform["translation"] = [float(x) for x in (dst_c - src_c).tolist()]
    if float(src_e.min()) > 1e-6 and not np.allclose(dst_e / np.maximum(src_e, 1e-9), 1.0, atol=1e-3):
        transform["scale"] = [float(x) for x in (dst_e / np.maximum(src_e, 1e-9)).tolist()]
    return transform or None


def can_generate_editable_step(project_path: Path, filename: str) -> bool:
    """True when a B-rep source exists to write ``{stem}.step`` on demand."""
    dest = _export_step_dest_for_model(project_path, filename)
    if dest.is_file() and looks_like_step_file(dest):
        return True
    stem = dest.stem
    source = _parent_brep_step_for_stem(project_path, stem)
    return source is not None and source.is_file()


def ensure_editable_step_for_export(project_path: Path, filename: str) -> Path | None:
    """Write a Fusion-editable STEP for this model from parent B-rep + FreeCAD/OCC.

    Hardware / McMaster gizmo bakes often write only ``{pn}_edited.glb``. Export
    still lists STEP from the catalog part number. This materializes
    ``{pn}_edited.step`` from the catalog solid in the edited pose.
    """
    project_path = Path(project_path)
    dest = _export_step_dest_for_model(project_path, filename)
    if dest.is_file() and looks_like_step_file(dest):
        return dest
    stem = dest.stem
    source = _parent_brep_step_for_stem(project_path, stem)
    if source is None or not source.is_file():
        return None
    dest.parent.mkdir(parents=True, exist_ok=True)
    if source.resolve() == dest.resolve():
        return dest
    transform: dict[str, Any] | None = None
    viewer = find_cad_file_for_stem(project_path, stem, {".glb", ".gltf"})
    parent_mesh = find_cad_file_for_stem(project_path, source.stem, {".glb", ".gltf"})
    if viewer is not None and parent_mesh is not None and viewer.resolve() != parent_mesh.resolve():
        transform = _infer_mesh_delta_transform(parent_mesh, viewer)
    if transform:
        try:
            from backend.services.freecad_transform import try_apply_freecad_step_transform

            written = try_apply_freecad_step_transform(
                project_path,
                source.name,
                transform,
                out_step=dest,
                viewer_path=parent_mesh,
            )
            if written is not None and written.is_file() and looks_like_step_file(written):
                logger.info("Wrote export STEP %s from %s via FreeCAD/OCC", dest.name, source.name)
                return written
        except Exception:
            logger.warning("FreeCAD/OCC export STEP failed for %s", dest.name, exc_info=True)
    try:
        shutil.copy2(source, dest)
        logger.info("Copied parent STEP %s → %s for export", source.name, dest.name)
        return dest
    except OSError as exc:
        logger.warning("Could not copy parent STEP %s → %s: %s", source.name, dest.name, exc)
        return source if source.is_file() else None


def _fusion_ready_step_export(
    project_path: Path,
    root_stem: str,
    filename: str,
) -> dict[str, Any] | None:
    """Pick one native editable B-rep STEP for downloads / Fusion (no Part rewrite)."""
    from backend.services.engine_layout import project_rel

    project_path = Path(project_path)
    _src, search_dirs = _model_source_and_export_dirs(project_path, filename)
    candidates: list[Path] = []
    # Native first — never prefer *.part.step caches (those break Extrude/Cut).
    for name in (
        f"{root_stem}.step",
        f"{root_stem}.STEP",
        f"{root_stem}.stp",
        f"{root_stem}.STP",
        Path(filename).name,
        f"{root_stem}.part.step",
        f"{root_stem}.fusionpart.step",
    ):
        leaf = Path(name).name
        for folder in search_dirs:
            path = folder / leaf
            if path.is_file() and path.suffix.lower() in {".step", ".stp"}:
                candidates.append(path_as_dirent(path))
            else:
                found = _find_cad_file_in_dir(folder, Path(leaf).stem, {".step", ".stp"})
                if found is not None:
                    candidates.append(found)
    found_step = find_step_source(project_path, root_stem)
    if found_step is not None and found_step.is_file() and _step_stem_matches_root(found_step, root_stem):
        candidates.insert(0, found_step)
    native = resolve_native_brep_step(project_path, filename)
    if native is not None and native.is_file() and _step_stem_matches_root(native, root_stem):
        candidates.insert(0, native)

    seen: set[str] = set()
    unique: list[Path] = []
    for path in candidates:
        if not _step_stem_matches_root(path, root_stem) and Path(filename).suffix.lower() not in STEP_SUFFIXES:
            continue
        if Path(filename).suffix.lower() in STEP_SUFFIXES and path.name != Path(filename).name:
            if not _step_stem_matches_root(path, root_stem):
                continue
        key = str(path.resolve()) if path.exists() else path.name
        if key in seen:
            continue
        seen.add(key)
        unique.append(path)

    def _score(path: Path) -> int:
        name = path.name.lower()
        score = 0
        try:
            if classify_step_file_kind(path) == "editable_brep":
                score += 10
        except Exception:
            pass
        if ".part." in name or ".fusionpart." in name:
            score -= 20
        if "__faceted" in name:
            score -= 30
        return score

    ranked = sorted(
        [p for p in unique if p.is_file() and "__faceted" not in p.name.lower() and _step_stem_matches_root(p, root_stem)],
        key=_score,
        reverse=True,
    )
    source = ranked[0] if ranked else None
    if source is not None:
        source = path_as_dirent(source)
    if source is None:
        dest = _export_step_dest_for_model(project_path, filename)
        if can_generate_editable_step(project_path, filename):
            return {
                "name": project_rel(project_path, dest),
                "format": "step",
                "size": dest.stat().st_size if dest.is_file() else 0,
                "convertible": not dest.is_file(),
                "step_kind": "editable_brep",
                "step_structure": "solid",
                "fusion_editable": True,
                "base": True,
                "label": "STEP",
                "download_name": f"{root_stem}.step",
            }
        return None
    try:
        kind = classify_step_file_kind(source)
    except Exception:
        kind = "unknown"
    return {
        "name": project_rel(project_path, source),
        "format": "step",
        "size": source.stat().st_size,
        "step_kind": kind if kind != "unknown" else "editable_brep",
        "step_structure": "assembly" if step_has_assembly_links(source) else "solid",
        "fusion_editable": kind == "editable_brep",
        "base": True,
        "label": "STEP",
        "download_name": f"{root_stem}.step",
    }


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


def build_visible_assembly_exports(
    project_path: Path,
    filenames: list[str],
    *,
    stem: str = "_export_visible_assembly",
    include_companions: bool = True,
) -> list[dict[str, Any]]:
    """Build downloadable artifacts for the currently visible browser components.

    Prefers existing viewer GLBs (copy / merge) over STEP retessellation so public
    share previews keep the same multi-body quality as the studio. Also tries to
    write a solid B-rep STEP compound from the visible native STEPs so Fusion /
    cloud push cannot fall back to a hidden sibling model.

    When ``include_companions`` is False (share-link minting), only the viewer GLB
    is written — skip STL / faceted STEP / 3MF / B-rep STEP which dominate latency.
    Catalog McMaster STEPs are also dropped from a multi-file bake so share mint
    does not tessellate every fastener before returning a URL.
    """
    safe_names: list[str] = []
    seen: set[str] = set()
    from backend.services.engine_layout import project_rel

    for raw in filenames:
        cleaned = str(raw or "").strip()
        if "#body:" in cleaned:
            cleaned = cleaned.split("#body:", 1)[0]
        located = resolve_project_file(project_path, cleaned)
        if located is None or not located.is_file():
            continue
        if located.suffix.lower() not in SUPPORTED_IMPORT | SUPPORTED_EXPORT:
            continue
        rel = project_rel(project_path, located)
        if not rel or rel in seen:
            continue
        seen.add(rel)
        safe_names.append(rel)

    if not safe_names:
        raise ValueError("No visible exportable components.")

    if not include_companions and len(safe_names) > 1:
        designed = [
            name
            for name in safe_names
            if not looks_like_mcmaster_part_stem(Path(name).stem)
        ]
        if designed:
            safe_names = designed

    for old in project_path.glob(f"{stem}.*"):
        if old.is_file():
            old.unlink(missing_ok=True)
    for old in project_path.glob(f"{stem}__faceted.*"):
        if old.is_file():
            old.unlink(missing_ok=True)

    # Resolve each visible name to the best on-disk viewer GLB when available.
    viewer_paths: list[Path] = []
    seen_viewers: set[str] = set()
    for safe in safe_names:
        src = resolve_project_file(project_path, safe) or (project_path / safe)
        viewer_name = None
        try:
            viewer_name = resolve_viewport_filename(project_path, safe)
        except Exception:
            viewer_name = None
        path = None
        if viewer_name:
            viewer_path = resolve_project_file(project_path, viewer_name)
            if viewer_path is not None and viewer_path.is_file():
                path = viewer_path
            elif (project_path / viewer_name).is_file():
                path = project_path / viewer_name
        if path is None and src.is_file() and src.suffix.lower() in {".glb", ".gltf"}:
            path = src
        if path is None:
            continue
        key = project_rel(project_path, path).lower()
        if key in seen_viewers:
            continue
        seen_viewers.add(key)
        viewer_paths.append(path)

    out_glb = project_path / f"{stem}.glb"
    # Single visible model with an existing GLB — copy it (no remesh).
    if len(viewer_paths) == 1 and len(safe_names) == 1:
        import shutil

        shutil.copy2(viewer_paths[0], out_glb)
    else:
        scene = trimesh.Scene()
        meshes: list[trimesh.Trimesh] = []
        sources = viewer_paths if viewer_paths else [project_path / name for name in safe_names]
        for src in sources:
            try:
                if src.suffix.lower() in {".glb", ".gltf"}:
                    loaded = load_scene(src)
                    if isinstance(loaded, trimesh.Scene):
                        for geom_name, geom in (loaded.geometry or {}).items():
                            if geom is None or getattr(geom, "is_empty", False):
                                continue
                            node = Path(src).stem if len(sources) > 1 else str(geom_name)
                            scene.add_geometry(geom.copy(), geom_name=node, node_name=node)
                            if isinstance(geom, trimesh.Trimesh):
                                meshes.append(geom)
                        continue
                mesh = load_mesh(src)
                if mesh.is_empty:
                    continue
                mesh.metadata["name"] = Path(src).stem
                meshes.append(mesh)
                scene.add_geometry(mesh.copy(), geom_name=Path(src).stem, node_name=Path(src).stem)
            except Exception:
                continue
        if scene.is_empty and not meshes:
            raise ValueError("Visible components did not contain exportable geometry.")
        if not scene.is_empty:
            export_scene(scene, out_glb)
        else:
            combined = repair_mesh(trimesh.util.concatenate(meshes)) if len(meshes) > 1 else repair_mesh(meshes[0])
            export_mesh(combined, out_glb)

    if not out_glb.is_file():
        raise ValueError("Could not build visible assembly GLB.")

    outputs = [out_glb]
    if not include_companions:
        return [
            {
                "name": out_glb.name,
                "format": "glb",
                "size": out_glb.stat().st_size,
            }
        ]

    # Companion mesh exports for download menu (STL / faceted STEP / 3MF).
    try:
        combined_mesh = load_mesh(out_glb)
    except Exception:
        combined_mesh = None
    if combined_mesh is not None and not combined_mesh.is_empty:
        stl = project_path / f"{stem}.stl"
        step = project_path / faceted_step_name(stem)
        three_mf = project_path / f"{stem}.3mf"
        try:
            export_mesh(combined_mesh, stl)
            outputs.append(stl)
        except Exception:
            pass
        try:
            export_mesh_step(combined_mesh, step)
            outputs.append(step)
        except Exception:
            pass
        try:
            export_mesh(combined_mesh, three_mf)
            outputs.append(three_mf)
        except Exception:
            pass

    # Prefer a solid B-rep compound of the *visible* native STEPs for Fusion.
    # Do not flatten via ensure_fusion_part_step — that breaks Extrude/Cut.
    solid_step = _build_visible_brep_step(project_path, safe_names, project_path / f"{stem}.step")
    if solid_step is not None and solid_step.is_file():
        outputs.insert(1, solid_step)

    result: list[dict[str, Any]] = []
    best_step: dict[str, Any] | None = None
    for out in outputs:
        if not out.is_file():
            continue
        fmt = _export_format(out.name)
        if fmt == "step":
            # One STEP only — native solid. Skip faceted mesh siblings.
            if "__faceted" in out.name.lower():
                continue
            try:
                kind = classify_step_file_kind(out)
            except Exception:
                kind = "unknown"
            item = {
                "name": out.name,
                "format": "step",
                "size": out.stat().st_size,
                "step_kind": kind if kind != "unknown" else "editable_brep",
                "step_structure": "assembly" if step_has_assembly_links(out) else "solid",
                "fusion_editable": kind == "editable_brep",
                "label": "STEP",
                "download_name": (
                    f"{Path(safe_names[0]).stem}.step"
                    if stem.startswith("_export_") and safe_names
                    else f"{stem}.step"
                ),
            }
            # Prefer non-faceted native solid; demote *.part.step caches.
            score = (10 if kind == "editable_brep" else 0) - (
                20 if (".part." in out.name.lower() or ".fusionpart." in out.name.lower()) else 0
            )
            prev = best_step
            prev_score = -999
            if prev is not None:
                prev_score = (10 if prev.get("step_kind") == "editable_brep" else 0) - (
                    20
                    if (
                        ".part." in str(prev.get("name") or "").lower()
                        or ".fusionpart." in str(prev.get("name") or "").lower()
                    )
                    else 0
                )
            if best_step is None or score > prev_score:
                best_step = item
            continue
        result.append(
            {
                "name": out.name,
                "format": fmt,
                "size": out.stat().st_size,
            }
        )
    if best_step is not None:
        result.append(best_step)
    return result


def _build_visible_brep_step(project_path: Path, filenames: list[str], dest: Path) -> Path | None:
    """Compound native solids from visible filenames into one Fusion-cuttable Part STEP."""
    from OCP.BRep import BRep_Builder
    from OCP.IFSelect import IFSelect_ReturnStatus
    from OCP.STEPControl import STEPControl_Reader
    from OCP.TopAbs import TopAbs_SOLID
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS_Compound

    solids = []
    for name in filenames:
        safe = Path(name).name
        native = resolve_native_brep_step(project_path, safe)
        step_path = native if native is not None else find_step_source(project_path, Path(safe).stem)
        if step_path is None or not step_path.is_file():
            continue
        if not is_editable_brep_step(step_path):
            continue
        try:
            reader = STEPControl_Reader()
            status = reader.ReadFile(str(step_path))
            if status != IFSelect_ReturnStatus.IFSelect_RetDone:
                continue
            reader.TransferRoots()
            shape = reader.OneShape()
            if shape.IsNull():
                continue
            exp = TopExp_Explorer(shape, TopAbs_SOLID)
            while exp.More():
                solids.append(exp.Current())
                exp.Next()
        except Exception:
            continue

    if not solids:
        return None

    if len(solids) == 1:
        out_shape = solids[0]
    else:
        builder = BRep_Builder()
        compound = TopoDS_Compound()
        builder.MakeCompound(compound)
        for solid in solids:
            builder.Add(compound, solid)
        out_shape = compound

    # Write via a temp single-solid STEP then flatten with the Fusion Part writer
    # so NEXT_ASSEMBLY_USAGE is never present (Extrude Cut needs a Part, not Assembly).
    tmp = dest.with_name(f"{dest.stem}.__tmp_compound{dest.suffix}")
    try:
        from OCP.STEPControl import STEPControl_StepModelType, STEPControl_Writer

        writer = STEPControl_Writer()
        writer.Transfer(out_shape, STEPControl_StepModelType.STEPControl_AsIs)
        status = writer.Write(str(tmp))
        if status != IFSelect_ReturnStatus.IFSelect_RetDone or not tmp.is_file():
            return None
        return export_step_as_single_part(tmp, dest)
    except Exception:
        return None
    finally:
        try:
            tmp.unlink(missing_ok=True)
        except Exception:
            pass


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
    """Delete a browser component and every project file in its logical family.

    Engine-folder publishes (``jake/``, ``vibecad/``, ``mesh/``) live beside
    the viewport catalog name. Transform/edit already resolve those paths;
    delete must unlink the same family or refresh reloads the part.
    """
    from backend.services.engine_layout import ENGINE_FOLDERS, project_rel

    src = resolve_project_file(project_path, filename)
    if src is None or not src.is_file():
        raise FileNotFoundError(f"Cannot delete missing file: {filename}")

    safe = src.name
    stem = Path(safe).stem
    root = _logical_component_root(stem)
    directories: list[Path] = [Path(project_path), src.parent]
    for folder in ENGINE_FOLDERS:
        directories.append(Path(project_path) / folder)

    deleted: list[str] = []
    seen_dirs: set[str] = set()
    for directory in directories:
        try:
            key = str(directory.resolve())
        except OSError:
            continue
        if key in seen_dirs or not directory.is_dir():
            continue
        seen_dirs.add(key)
        for path in sorted(directory.iterdir(), key=lambda p: p.name):
            if not path.is_file() or path.name.startswith("_active_"):
                continue
            artifact_stem = _artifact_stem(path.name)
            if (
                path.name == safe
                or artifact_stem == stem
                or _logical_component_root(artifact_stem) == root
            ):
                rel = project_rel(project_path, path)
                path.unlink()
                deleted.append(rel)
    if not any(Path(name).name == safe for name in deleted):
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


def _step_has_overflow_bbox(step_path: Path) -> bool:
    """True when OCC reports a ±1e100 / Inf solid box (unbounded STEP cylinders)."""
    try:
        from OCP.Bnd import Bnd_Box
        from OCP.BRepBndLib import BRepBndLib
        from OCP.IFSelect import IFSelect_ReturnStatus
        from OCP.STEPControl import STEPControl_Reader
    except Exception:
        return False
    try:
        reader = STEPControl_Reader()
        if reader.ReadFile(str(step_path)) != IFSelect_ReturnStatus.IFSelect_RetDone:
            return False
        reader.TransferRoots()
        shape = reader.OneShape()
        if shape.IsNull():
            return False
        box = Bnd_Box()
        BRepBndLib.Add_s(shape, box, False)
        vals = [float(v) for v in box.Get()]
        return (not all(math.isfinite(v) for v in vals)) or max(abs(v) for v in vals) > _CAD_VERTEX_ABS_LIMIT
    except Exception:
        return False


def _patch_build123d_color(mod) -> None:
    bd = getattr(mod, "bd", None) or getattr(mod, "build123d", None)
    if bd is None or not hasattr(bd, "Color"):
        return
    orig = bd.Color

    def _tolerant_color(*args, **kwargs):
        try:
            return orig(*args, **kwargs)
        except Exception:
            try:
                return orig(0.2, 0.2, 0.2)
            except Exception:
                return orig()

    bd.Color = _tolerant_color


def _shape_from_python_sidecar(mod):
    candidates = []
    for name in ("make_bracket", "gen_step"):
        fn = getattr(mod, name, None)
        if callable(fn):
            candidates.append(fn)
    for name, fn in vars(mod).items():
        if name.startswith("make_") and callable(fn) and fn not in candidates:
            candidates.append(fn)
    for fn in candidates:
        try:
            result = fn()
        except TypeError:
            continue
        except Exception:
            continue
        if result is None:
            continue
        wrapped = getattr(result, "wrapped", result)
        if hasattr(wrapped, "IsNull") and not wrapped.IsNull():
            return wrapped
    return None


def _repair_overflow_step_from_python(step_path: Path) -> bool:
    """Rewrite a poisoned STEP from its Jake .py sidecar using the live OCP solid.

    cadgen/XCAF STEP can serialize fillet coves as unbounded cylinders (X=2e100).
    The in-memory build123d solid is finite; STEPControl_Writer AsIs round-trips it.
    """
    py_path = Path(step_path).with_suffix(".py")
    if not py_path.is_file():
        return False
    import importlib.util
    import sys
    import tempfile

    cadgen_src = Path(__file__).resolve().parents[1] / "skills" / "_packages" / "cadgen" / "src"
    if cadgen_src.is_dir() and str(cadgen_src) not in sys.path:
        sys.path.insert(0, str(cadgen_src))
    spec = importlib.util.spec_from_file_location(f"cad_sidecar_{py_path.stem}", py_path)
    if spec is None or spec.loader is None:
        return False
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
        _patch_build123d_color(mod)
        shape = _shape_from_python_sidecar(mod)
        if shape is None:
            return False
        from OCP.IFSelect import IFSelect_ReturnStatus
        from OCP.STEPControl import STEPControl_StepModelType, STEPControl_Writer

        tmp = Path(tempfile.mkdtemp()) / f"{Path(step_path).stem}.step"
        writer = STEPControl_Writer()
        writer.Transfer(shape, STEPControl_StepModelType.STEPControl_AsIs)
        status = writer.Write(str(tmp))
        if status != IFSelect_ReturnStatus.IFSelect_RetDone or not tmp.is_file():
            return False
        if _step_has_overflow_bbox(tmp):
            logger.warning("Python sidecar STEP rebuild still overflowed for %s", step_path.name)
            return False
        shutil.copy2(tmp, step_path)
        logger.info("Rebuilt overflow STEP %s from Python sidecar %s", step_path.name, py_path.name)
        return True
    except Exception as exc:
        logger.warning("Could not rebuild overflow STEP %s from Python: %s", step_path.name, exc)
        return False


def _finalize_preview_glb(step_path: Path, dest: Path) -> None:
    """Sanitize Infinity/overflow verts, match mm units, rewrite RFC-8259 JSON."""
    try:
        scene = load_scene(dest)
        sanitize_scene_finite(scene)
        export_scene(scene, dest)
    except Exception as exc:
        logger.debug("Could not sanitize preview GLB %s: %s", dest.name, exc)
    _match_glb_scale_to_step(step_path, dest)
    from backend.services.json_finite import rewrite_glb_finite_json

    rewrite_glb_finite_json(dest)


def _assert_preview_has_3d_extent(path: Path) -> None:
    """Reject preview exports whose world bounds collapsed onto a plane or line."""
    scene = load_scene(path)
    bounds = np.asarray(scene.bounds, dtype=float) if scene.bounds is not None else np.empty((0, 3))
    if bounds.shape != (2, 3) or not np.isfinite(bounds).all():
        raise ValueError(f"CAD preview has no finite 3D bounds: {Path(path).name}")
    extents = np.abs(bounds[1] - bounds[0])
    longest = float(np.max(extents))
    collapse = max(longest * 1e-7, 1e-9)
    if longest <= 0 or bool(np.any(extents <= collapse)):
        values = " × ".join(f"{value:.6g}" for value in extents)
        raise ValueError(f"CAD preview collapsed to {values}: {Path(path).name}")


def tessellate_step_to_glb(
    step_path: Path,
    glb_path: Path | None = None,
    *,
    force: bool = False,
) -> Path:
    """Convert a STEP file to GLB, preserving per-body colours and smooth normals.

    Uses OCC's XCAF (colour-aware) STEP reader and the RWGltf_CafWriter to write
    a GLTF/GLB that carries original material colours from Onshape appearances.
    Falls back to the legacy STL-route if XCAF writing fails.

    ``force=True`` rebuilds even when an existing GLB looks newer (required after
    in-place STEP move/delete so the viewport cannot keep a stale preview).
    """
    dest = Path(glb_path) if glb_path is not None else Path(step_path).with_suffix(".glb")
    if _step_has_overflow_bbox(Path(step_path)) and _repair_overflow_step_from_python(Path(step_path)):
        try:
            dest.unlink(missing_ok=True)
        except OSError:
            pass
    if not force:
        try:
            if dest.is_file() and dest.stat().st_size > 64:
                step_mtime = Path(step_path).stat().st_mtime
                if dest.stat().st_mtime >= step_mtime:
                    # OCC can write valid JSON with 1e100 extrema whose float32 BIN is Inf.
                    from backend.services.json_finite import glb_json_has_nonfinite, glb_json_needs_sanitize

                    if glb_json_needs_sanitize(dest):
                        _finalize_preview_glb(step_path, dest)
                    if not glb_json_has_nonfinite(dest):
                        return dest
        except OSError:
            pass
        cached = _try_reuse_cached_preview_glb(step_path, dest)
        if cached is not None:
            _finalize_preview_glb(step_path, dest)
            from backend.services.json_finite import glb_json_has_nonfinite

            if not glb_json_has_nonfinite(dest):
                _store_cached_preview_glb(step_path, dest)
                return dest
    candidate = dest.with_name(f".{dest.name}.{uuid.uuid4().hex}.candidate.glb")
    try:
        _step_to_glb_xcaf(step_path, candidate)
        _finalize_preview_glb(step_path, candidate)
        _assert_preview_has_3d_extent(candidate)
        os.replace(candidate, dest)
        _store_cached_preview_glb(step_path, dest)
        return dest
    except Exception as exc:
        candidate.unlink(missing_ok=True)
        dest_name = dest.name.lower()
        if ".generation-live." in dest_name:
            logger.warning(
                "XCAF GLTF export failed (%s); skipping STL-route tessellate for live preview %s",
                exc,
                dest.name,
            )
            if dest.is_file() and dest.stat().st_size > 64:
                _finalize_preview_glb(step_path, dest)
                return dest
            raise
        logger.warning("XCAF GLTF export failed (%s), falling back to STL route", exc)
        mesh = import_step_mesh(step_path)
        sanitize_trimesh_finite(mesh)
        scene = trimesh.Scene()
        scene.add_geometry(mesh, geom_name=dest.stem, node_name=dest.stem)
        try:
            export_scene(scene, candidate)
            _finalize_preview_glb(step_path, candidate)
            _assert_preview_has_3d_extent(candidate)
            os.replace(candidate, dest)
            _store_cached_preview_glb(step_path, dest)
            return dest
        finally:
            candidate.unlink(missing_ok=True)


def _preview_glb_fingerprint(step_path: Path) -> str | None:
    """Content fingerprint for STEP→GLB preview reuse across projects."""
    try:
        path = Path(step_path)
        h = hashlib.sha256()
        with path.open("rb") as fh:
            for chunk in iter(lambda: fh.read(1024 * 1024), b""):
                h.update(chunk)
        return h.hexdigest()
    except OSError:
        return None


def _preview_glb_cache_path(step_path: Path) -> Path | None:
    digest = _preview_glb_fingerprint(step_path)
    if not digest:
        return None
    # Prefer project-parent cache so McMaster re-inserts reuse prior tessellation.
    root = Path(step_path).resolve().parent.parent
    return root / _PREVIEW_CACHE_DIRNAME / f"{digest}.glb"


def _try_reuse_cached_preview_glb(step_path: Path, glb_path: Path) -> Path | None:
    cache = _preview_glb_cache_path(step_path)
    dest = Path(glb_path)
    if cache is None or not cache.is_file() or cache.stat().st_size < 64:
        return None
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.resolve() != cache.resolve():
            shutil.copy2(cache, dest)
        logger.info("Reused cached STEP preview GLB for %s → %s", step_path.name, dest.name)
        return dest
    except OSError as exc:
        logger.warning("Could not reuse cached preview GLB for %s: %s", step_path.name, exc)
        return None


def _store_cached_preview_glb(step_path: Path, glb_path: Path) -> None:
    cache = _preview_glb_cache_path(step_path)
    src = Path(glb_path)
    if cache is None or not src.is_file() or src.stat().st_size < 64:
        return
    try:
        cache.parent.mkdir(parents=True, exist_ok=True)
        if not cache.is_file() or cache.stat().st_size != src.stat().st_size:
            tmp = cache.with_suffix(".glb.tmp")
            shutil.copy2(src, tmp)
            tmp.replace(cache)
    except OSError as exc:
        logger.debug("Could not store preview GLB cache for %s: %s", step_path.name, exc)


def preview_glb_build_lock_path(glb_path: Path) -> Path:
    return Path(glb_path).with_name(Path(glb_path).name + ".building")


def wait_for_preview_glb(
    glb_path: Path,
    *,
    timeout_s: float = 12 * 60,
    poll_s: float = 0.35,
) -> Path | None:
    """Wait for a background STEP→GLB thread without starting a second tessellation."""
    dest = Path(glb_path)
    if dest.suffix.lower() != ".glb":
        try:
            if dest.is_file() and dest.stat().st_size > 64:
                return dest
        except OSError:
            pass
        return None
    deadline = time.time() + timeout_s
    idle_rounds = 0
    while time.time() < deadline:
        try:
            if dest.is_file() and dest.stat().st_size > 64:
                return dest
        except OSError:
            pass
        if is_preview_glb_building(dest):
            idle_rounds = 0
            time.sleep(poll_s)
            continue
        # schedule_tessellate may not have created the lock yet.
        idle_rounds += 1
        if idle_rounds >= 6:
            return None
        time.sleep(poll_s)
    try:
        if dest.is_file() and dest.stat().st_size > 64:
            return dest
    except OSError:
        pass
    return None


def is_preview_glb_building(glb_path: Path) -> bool:
    lock = preview_glb_build_lock_path(glb_path)
    if not lock.is_file():
        return False
    try:
        age = time.time() - lock.stat().st_mtime
        # Stale locks after a killed worker — allow a new build.
        if age > 45 * 60:
            lock.unlink(missing_ok=True)
            return False
    except OSError:
        return False
    return True


def schedule_tessellate_step_to_glb(
    step_path: Path,
    glb_path: Path | None = None,
    *,
    on_done: Optional[Callable[[Path | None, BaseException | None], None]] = None,
) -> bool:
    """Start STEP→GLB in a daemon thread. Returns True if a build is in flight or started.

    Never blocks the caller on tessellation — large McMaster STEPs take minutes and
    would otherwise trip uvicorn worker healthchecks (502s on /files/*.glb).
    """
    step = Path(step_path)
    dest = Path(glb_path) if glb_path is not None else step.with_suffix(".glb")
    if dest.is_file() and dest.stat().st_size > 0:
        return False
    key = str(dest.resolve())
    lock = preview_glb_build_lock_path(dest)

    with _PREVIEW_GLB_GUARD:
        existing = _PREVIEW_GLB_THREADS.get(key)
        if existing is not None and existing.is_alive():
            return True
        if is_preview_glb_building(dest):
            return True
        try:
            fd = os.open(str(lock), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(f"{os.getpid()}\n{time.time()}\n{step.name}\n")
        except FileExistsError:
            if is_preview_glb_building(dest):
                return True
            try:
                lock.unlink(missing_ok=True)
                fd = os.open(str(lock), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                with os.fdopen(fd, "w", encoding="utf-8") as fh:
                    fh.write(f"{os.getpid()}\n{time.time()}\n{step.name}\n")
            except FileExistsError:
                return True

        def _run() -> None:
            err: BaseException | None = None
            out: Path | None = None
            try:
                out = tessellate_step_to_glb(step, dest)
            except BaseException as exc:  # noqa: BLE001 — surface to callback, then clear lock
                err = exc
                logger.warning("Background STEP preview GLB failed for %s: %s", step.name, exc)
            finally:
                try:
                    lock.unlink(missing_ok=True)
                except OSError:
                    pass
                with _PREVIEW_GLB_GUARD:
                    _PREVIEW_GLB_THREADS.pop(key, None)
                if on_done is not None:
                    try:
                        on_done(out, err)
                    except Exception as cb_exc:  # pragma: no cover
                        logger.debug("preview GLB on_done failed: %s", cb_exc)

        thread = threading.Thread(
            target=_run,
            name=f"step-preview-glb:{dest.name[:48]}",
            daemon=True,
        )
        _PREVIEW_GLB_THREADS[key] = thread
        thread.start()
        return True


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
    delta = np.asarray(bounds[1], dtype=float) - np.asarray(bounds[0], dtype=float)
    if delta.size == 0 or not np.isfinite(delta).all():
        return 0.0
    return float(np.max(delta))


def _match_glb_scale_to_step(step_path: Path, glb_path: Path) -> None:
    """Keep OCC/Jake-written GLB previews in the same units as the source STEP.

    Jake/cadpy and some STEP→GLB writers follow glTF's metre convention even when
    the source STEP is millimetres. Render Studio's CAD workspace uses millimetres, so
    compare GLB bounds to the STEP tessellation and bake a scale correction when
    the ratio is clearly unit-related (~1000×).

    Scales each scene geometry in place and re-exports the scene graph so
    multi-body Fusion assemblies stay separate meshes (``__part_*.glb`` split
    depends on that).
    """
    try:
        scene = load_scene(glb_path)
        glb_extent = _scene_extent(scene)
        if glb_extent > 0:
            try:
                step_mesh = import_step_mesh(step_path)
                step_extent = float(np.max(step_mesh.extents))
            except Exception:
                step_extent = 0.0
            if math.isfinite(step_extent) and step_extent > 0:
                ratio = step_extent / glb_extent
                # Unit mismatch only — ignore tiny numeric noise / already-matched files.
                if 50.0 <= ratio <= 20000.0:
                    parts = _meshes_from_scene(scene)
                    if len(parts) > 1:
                        rebuilt = trimesh.Scene()
                        for label, mesh in parts:
                            scaled = mesh_copy(mesh)
                            scaled.apply_scale(ratio)
                            rebuilt.add_geometry(scaled, geom_name=label, node_name=label)
                        export_scene(rebuilt, glb_path)
                    else:
                        scene.apply_scale(ratio)
                        export_scene(scene, glb_path)
                    logger.info("Scaled STEP preview GLB %s by %.6g to match source units", glb_path.name, ratio)
                # Known STEP units take precedence over the fallback size guess,
                # including legitimate millimetre parts smaller than 2.5 mm.
                return
        _bake_gltf_metres_to_millimetres(glb_path)
    except Exception as exc:  # pragma: no cover - preview scale fix is best-effort
        logger.debug("Could not verify STEP preview scale for %s: %s", glb_path.name, exc)


_METRE_MACHINE_MIN = 0.05  # 50 mm stored as glTF metres
_METRE_MACHINE_MAX = 2.5  # 2.5 m stored as glTF metres


def workspace_unit_scale(extent: float) -> float:
    """Return 1000 if `extent` looks like metres in a millimetre CAD workspace.

    A 50 mm STEP stays 1.0; a 0.05 m (glTF) preview of the same part is 1000.
    Already-mm chassis (~300+) and screws (~6–20) are not rescaled.
    """
    try:
        value = float(extent)
    except (TypeError, ValueError):
        return 1.0
    if not math.isfinite(value) or value <= 0:
        return 1.0
    if _METRE_MACHINE_MIN <= value <= _METRE_MACHINE_MAX:
        return 1000.0
    if 0.0005 <= value < _METRE_MACHINE_MIN:
        return 1000.0
    return 1.0


def _bake_gltf_metres_to_millimetres(glb_path: Path) -> bool:
    """FreeCAD-style: a ~50 mm–2.5 m solid sitting in glTF metres becomes millimetres.

    OCC/cadpy often write 356 mm as 0.356. The viewport is millimetres. Skip parts
    already in mm (screws ~6–20, chassis ~300+) so we never double-scale.
    """
    path = Path(glb_path)
    if not path.is_file():
        return False
    scene = load_scene(path)
    extent = _scene_extent(scene)
    scale = workspace_unit_scale(extent)
    if abs(scale - 1.0) <= 1e-9:
        return False
    scene.apply_scale(scale)
    export_scene(scene, path)
    logger.info("Scaled metre-sized preview GLB %s ×%.6g to millimetres", path.name, scale)
    return True


def ensure_imported_mesh_millimetres(path: Path) -> bool:
    """Persist mm units on uploaded mesh/GLB. No-op when already millimetres."""
    dest = Path(path)
    if not dest.is_file():
        return False
    suffix = dest.suffix.lower()
    if suffix in {".glb", ".gltf"}:
        return _bake_gltf_metres_to_millimetres(dest)
    if suffix not in {".stl", ".obj", ".ply", ".off", ".3mf"}:
        return False
    mesh = load_mesh(dest)
    extents = getattr(mesh, "extents", None)
    extent = float(max(extents)) if extents is not None and len(extents) else 0.0
    scale = workspace_unit_scale(extent)
    if abs(scale - 1.0) <= 1e-9:
        return False
    mesh.apply_scale(scale)
    export_mesh(mesh, dest)
    logger.info("Scaled imported mesh %s ×%.6g to millimetres", dest.name, scale)
    return True


_GLB_PREVIEW_STATS_CACHE: dict[str, tuple[str, tuple[int, int, int]]] = {}
_GLB_PREVIEW_STATS_CACHE_MAX = 256


def _read_glb_json_chunk(path: Path) -> dict[str, Any] | None:
    """Best-effort glTF JSON chunk from a GLB (JSON header only — never the BIN)."""
    try:
        from backend.services.json_finite import loads_finite, read_glb_json_chunk_bytes

        raw = read_glb_json_chunk_bytes(path)
        if not raw:
            return None
        return loads_finite(raw.decode("utf-8"))
    except Exception:
        return None


def _glb_preview_stats(path: Path) -> tuple[int, int, int]:
    """Return ``(mesh_count, material_count, color0_primitive_count)``."""
    path = Path(path)
    try:
        digest = hashlib.sha256()
        with path.open("rb") as fh:
            for block in iter(lambda: fh.read(1024 * 1024), b""):
                digest.update(block)
        content_hash = digest.hexdigest()
    except OSError:
        return (0, 0, 0)
    cache_key = str(path)
    cached = _GLB_PREVIEW_STATS_CACHE.get(cache_key)
    if cached and cached[0] == content_hash:
        return cached[1]
    gltf = _read_glb_json_chunk(path)
    if not gltf:
        stats = (0, 0, 0)
    else:
        meshes = gltf.get("meshes") or []
        materials = gltf.get("materials") or []
        color0 = 0
        for mesh in meshes:
            for prim in mesh.get("primitives") or []:
                attrs = prim.get("attributes") or {}
                if "COLOR_0" in attrs:
                    color0 += 1
        stats = (len(meshes), len(materials), color0)
    _GLB_PREVIEW_STATS_CACHE[cache_key] = (content_hash, stats)
    if len(_GLB_PREVIEW_STATS_CACHE) > _GLB_PREVIEW_STATS_CACHE_MAX:
        for drop_key in list(_GLB_PREVIEW_STATS_CACHE.keys())[: len(_GLB_PREVIEW_STATS_CACHE) // 2]:
            _GLB_PREVIEW_STATS_CACHE.pop(drop_key, None)
    return stats


def jake_viewport_glb_for_stem(project_path: Path, stem: str) -> Path | None:
    """Return Jake CADJS ``.{stem}.step.glb`` when present."""
    jake = Path(project_path) / f".{stem}.step.glb"
    if jake.is_file():
        return jake
    stp = Path(project_path) / f".{stem}.stp.glb"
    return stp if stp.is_file() else None


def ensure_public_glb_from_jake_preview(project_path: Path, filename: str) -> Path | None:
    """Materialize catalog ``{stem}.glb`` from a real assembled mesh when the public file is gone or a stub.

    Lite view=open lists a public identity after a STEP/GLB tombstone or after a
    Google Drive ``{"id":...}`` pointer overwrote the catalog name. The viewport
    then GETs that name and 404s / fails to parse even though ``vibecad/{stem}.glb``
    or Jake ``.{stem}.step.glb`` is still on disk. Copying (not synthesizing)
    restores the listed catalog path.
    """
    project_path = Path(project_path)
    requested = Path(str(filename or "").replace("\\", "/")).name
    if not requested or requested in {".", ".."}:
        return None
    lower = requested.lower()
    if requested.startswith(".") and (lower.endswith(".step.glb") or lower.endswith(".stp.glb")):
        jake = project_path / requested
        return jake if jake.is_file() else None
    if not lower.endswith(".glb"):
        return None
    dest = project_path / requested
    dest_ok = dest.is_file() and not looks_like_drive_id_stub(dest)
    if dest_ok:
        return dest
    stem = Path(requested).stem
    src = jake_viewport_glb_for_stem(project_path, stem)
    if src is None or not src.is_file():
        found = find_cad_file_for_stem(project_path, stem, {".glb", ".gltf"})
        if found is not None and found.is_file() and found.resolve() != dest.resolve():
            src = found
    if src is None or not src.is_file():
        return None
    try:
        shutil.copy2(src, dest)
    except OSError:
        logger.warning("Could not promote assembled mesh %s → %s", src.name, dest.name)
        return src
    return dest if dest.is_file() and not looks_like_drive_id_stub(dest) else src


def _jake_hidden_assembly_previews(project_path: Path) -> list[tuple[str, Path]]:
    """Assembled Jake viewers still on disk after the public STEP/GLB was tombstoned."""
    out: list[tuple[str, Path]] = []
    root = Path(project_path)
    try:
        children = list(root.iterdir())
    except OSError:
        return out
    for path in children:
        if not path.is_file():
            continue
        name = path.name
        if not (name.startswith(".") and name.lower().endswith(".step.glb")):
            continue
        stem = name[1 : -len(".step.glb")]
        if not stem or stem.lower().endswith("_exploded"):
            continue
        if looks_like_mcmaster_part_stem(stem):
            continue
        out.append((stem, path))
    return out


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
    from backend.services.engine_layout import project_rel, resolve_in_layout

    project_path = Path(project_path)
    resolved = resolve_in_layout(project_path, filename)
    if resolved is None:
        candidate = project_path / Path(str(filename or "")).name
        resolved = candidate if candidate.is_file() else None
    folder = resolved.parent if resolved is not None else project_path
    safe = resolved.name if resolved is not None else Path(str(filename or "")).name
    suffix = Path(safe).suffix.lower()
    stem = Path(safe).stem

    def _rel(path: Path) -> str:
        return project_rel(project_path, path)

    if suffix == ".stl":
        # STL is a download sidecar, not a live-draw mesh when CAD GLB/STEP exists.
        for ext in (".glb", ".gltf"):
            sibling = folder / f"{stem}{ext}"
            if not sibling.is_file():
                sibling = project_path / f"{stem}{ext}"
            if sibling.is_file():
                return _rel(sibling)
        for ext in (".step", ".stp"):
            sibling = folder / f"{stem}{ext}"
            if not sibling.is_file():
                sibling = project_path / f"{stem}{ext}"
            if sibling.is_file():
                glb = folder / f"{stem}.glb"
                if not glb.is_file():
                    glb = project_path / f"{stem}.glb"
                if glb.is_file():
                    return _rel(glb)
                return viewer_filename_for_model(sibling.name, project_path)

    if suffix in STEP_SUFFIXES | IGES_SUFFIXES | BREP_SUFFIXES | PROPRIETARY_CAD_SUFFIXES | {".3mf"}:
        # Prefer Jake multi-body materials, then solid preview, then face-dumped OCC mesh.
        # 3MF / STEP / SolidWorks natives are not browser loaders — resolve to sibling GLB.
        solid_glb = folder / f"{stem}.glb"
        if not solid_glb.is_file():
            solid_glb = project_path / f"{stem}.glb"
        faceted_glb = folder / f"{stem}__faceted.glb"
        if not faceted_glb.is_file():
            faceted_glb = project_path / f"{stem}__faceted.glb"
        edited_glb = latest_edited_viewer_variant(project_path, stem, newer_than=solid_glb)
        if edited_glb is not None:
            return _rel(edited_glb)
        jake_glb = folder / f".{stem}.step.glb"
        if not jake_glb.is_file():
            jake_glb = jake_viewport_glb_for_stem(project_path, stem)
        else:
            jake_glb = jake_glb if jake_glb.is_file() else None
        if jake_glb is not None and prefer_jake_viewport_glb(solid_glb, jake_glb):
            return _rel(jake_glb)
        if solid_glb.is_file():
            return _rel(solid_glb)
        if faceted_glb.is_file():
            return _rel(faceted_glb)
        if jake_glb is not None:
            return _rel(jake_glb)
        if suffix == ".3mf":
            for ext in (".step", ".stp", ".stl"):
                sibling = folder / f"{stem}{ext}"
                if not sibling.is_file():
                    sibling = project_path / f"{stem}{ext}"
                if sibling.is_file():
                    return _rel(sibling)
            return _rel(resolved) if resolved is not None else safe
        # Browser cannot load SolidWorks / Fusion natives — sibling GLB is built
        # from STEP (including a McMaster STEP refetch when only .sldprt exists).
        return _rel(folder / f"{stem}.glb") if (folder / f"{stem}.glb").is_file() else f"{stem}.glb"
    if suffix in MESH_VIEW_SUFFIXES | {".glb", ".gltf"}:
        # If someone points at *__faceted.glb, prefer the solid sibling when present.
        if "__faceted" in stem.lower():
            solid_stem = re.sub(r"__faceted$", "", stem, flags=re.I)
            solid = folder / f"{solid_stem}{suffix}"
            if not solid.is_file():
                solid = project_path / f"{solid_stem}{suffix}"
            if solid.is_file():
                return _rel(solid)
            return _rel(resolved) if resolved is not None else safe
        solid = resolved if resolved is not None else (project_path / safe)
        edited_glb = latest_edited_viewer_variant(project_path, stem, newer_than=solid)
        if edited_glb is not None:
            return _rel(edited_glb)
        jake_glb = folder / f".{stem}.step.glb"
        if not jake_glb.is_file():
            jake_glb = jake_viewport_glb_for_stem(project_path, stem)
        else:
            jake_glb = jake_glb
        if jake_glb is not None and jake_glb.is_file() and prefer_jake_viewport_glb(solid, jake_glb):
            return _rel(jake_glb)
        return _rel(solid) if solid.is_file() else safe
    return _rel(resolved) if resolved is not None else safe


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
    for suffix in (
        ".program.json",
        ".sketch.json",
        ".sim.json",
        ".mjcf.xml",
        ".freecad.py",
        ".freecad.json",
        ".vibecad.json",
        ".vibecad.py",
    ):
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


_ORPHAN_EXPLODED_PART_RE = re.compile(r"^(.+)__part_\d+_", re.I)


def collapse_orphan_exploded_part_components(components: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One Component when exploded ``__part_`` files exist without a parent assembly GLB."""
    rows = [c for c in (components or []) if isinstance(c, dict)]
    stems = {str(c.get("stem") or "") for c in rows}
    groups: dict[str, list[dict[str, Any]]] = {}
    rest: list[dict[str, Any]] = []
    for comp in rows:
        stem = str(comp.get("stem") or "")
        match = _ORPHAN_EXPLODED_PART_RE.match(stem)
        parent = match.group(1) if match else ""
        if parent and parent not in stems:
            groups.setdefault(parent, []).append(comp)
        else:
            rest.append(comp)
    out = list(rest)
    for parent, parts in groups.items():
        if len(parts) < 2:
            out.extend(parts)
            continue
        primary = max(parts, key=lambda p: int(p.get("size") or 0))
        engine = str(primary.get("engine") or "")
        parent_rel = str(primary.get("name") or "").replace(str(primary.get("stem") or ""), parent, 1)
        if not parent_rel or parent_rel == str(primary.get("name") or ""):
            parent_rel = f"{engine}/{parent}.glb" if engine else f"{parent}.glb"
        out.append(
            {
                "id": f"{engine}/{parent}".strip("/") or parent,
                "name": parent_rel,
                "stem": parent,
                "engine": engine or None,
                "label": _humanize_component_stem(parent),
                "format": primary.get("format") or "glb",
                "viewer_filename": primary.get("viewer_filename") or primary.get("name"),
                "size": sum(int(p.get("size") or 0) for p in parts),
                "primary": False,
                "auto_load": True,
                "virtual_component": True,
                "orphan_part_group": True,
            }
        )
    return out


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
    root = Path(project_path)
    folders = [root]
    try:
        from backend.services.engine_layout import ENGINE_FOLDERS

        folders.extend(root / name for name in ENGINE_FOLDERS)
    except Exception:
        pass
    for folder in folders:
        if any(
            (folder / f"{base}{ext}").is_file()
            for ext in (".glb", ".gltf", ".step", ".stp", ".stl", ".3mf")
        ):
            return True
    return jake_viewport_glb_for_stem(project_path, base) is not None


def _is_part_extension_sidecar_stem(stem: str, project_path: Path) -> bool:
    """Hide ``foo.part.step`` when ``foo.step`` / ``foo.glb`` already exists.

    Some exports write a spurious ``*.part.step`` next to the real assembly; it
    steals primary and shows as a duplicate component with no Bodies.
    """
    text = str(stem or "")
    if not text.lower().endswith(".part"):
        return False
    parent = text[: -len(".part")]
    if not parent:
        return False
    return _parent_assembly_exists(project_path, parent)


_GENERIC_PROMOTED_PART_SLUG_RE = re.compile(
    r"^(?:body|part|solid|compound|shape|object|mesh|result)(?:[_\-\s]*\d+)?$",
    re.I,
)
_COPY_CLONE_STEM_RE = re.compile(r"^(.+)_copy\d*$", re.I)
_DUPLICATE_PART_SIDECARS = (
    ".glb",
    ".gltf",
    ".step",
    ".stp",
    ".stl",
    ".3mf",
    ".obj",
    ".place.json",
    ".sim.json",
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
    if match and "__part_" not in stem.lower() and _parent_assembly_exists(project_path, match.group(1)):
        return True
    return False


def is_lite_hidden_design_sidecar(stem: str, project_path: Path) -> bool:
    """True for generate-time exploded clones that must not be sibling Components."""
    text = str(stem or "")
    if not text:
        return False
    return (
        _is_promoted_detail_part_stem(text, project_path)
        or _is_part_extension_sidecar_stem(text, project_path)
        or _is_exploded_assembly_sidecar_stem(text, project_path)
        or _is_faceted_export_stem(text)
    )


def _promoted_part_slug(stem: str) -> str | None:
    match = re.match(r"^.+__part_\d+_(.+)$", str(stem or ""), re.I)
    return match.group(1) if match else None


def is_generic_promoted_part_slug(slug: str | None) -> bool:
    text = str(slug or "").strip()
    return bool(text) and bool(_GENERIC_PROMOTED_PART_SLUG_RE.fullmatch(text))


def is_duplicate_generated_part_clone(stem: str, project_path: Path) -> bool:
    """True when ``stem`` is a generated copy of one parent solid — safe to quarantine.

    Conservative: uniquely named assembly members (``auger__part_01_hopper``) stay.
    Generic exploded bodies, disconnected-mesh ``_part01`` dumps, ``_copy`` clones,
    and ``foo.part`` sidecars of an existing assembly are copies.
    """
    text = str(stem or "")
    if not text or looks_like_mcmaster_part_stem(text):
        return False
    if _is_part_extension_sidecar_stem(text, project_path):
        return True
    copy_match = _COPY_CLONE_STEM_RE.match(text)
    if copy_match and _parent_assembly_exists(project_path, copy_match.group(1)):
        return True
    compact = re.match(r"^(.+)_part\d+(?:_\d+)?$", text, re.I)
    if compact and "__part_" not in text.lower() and _parent_assembly_exists(project_path, compact.group(1)):
        return True
    slug = _promoted_part_slug(text)
    if slug and is_generic_promoted_part_slug(slug):
        parent = re.match(r"^(.+)__part_\d+_", text, re.I)
        if parent and _parent_assembly_exists(project_path, parent.group(1)):
            return True
    return False


def quarantine_duplicate_generated_parts(
    project_path: Path,
    *,
    trash_dirname: str = ".duplicate_parts_trash",
) -> dict[str, Any]:
    """Move exploded generate clones into a project trash folder. Never McMaster."""
    root = Path(project_path)
    moved: list[str] = []
    skipped: list[str] = []
    if not root.is_dir():
        return {"project": root.name, "moved": moved, "skipped": skipped, "count": 0}
    from backend.services.engine_layout import ENGINE_FOLDERS, project_rel

    trash = root / trash_dirname
    stems: list[tuple[Path, str]] = []
    search_dirs = [root, *(root / folder for folder in ENGINE_FOLDERS)]
    seen_dirs: set[str] = set()
    for directory in search_dirs:
        key = str(directory)
        if key in seen_dirs or not directory.is_dir():
            continue
        seen_dirs.add(key)
        try:
            children = list(directory.iterdir())
        except OSError:
            continue
        for path in children:
            if not path.is_file() or path.name.startswith("."):
                continue
            if looks_like_mcmaster_part_stem(path.stem):
                skipped.append(path.name)
                continue
            if is_duplicate_generated_part_clone(path.stem, root):
                stems.append((path, path.stem))
    seen_stems: set[str] = set()
    for path, stem in stems:
        folder_key = f"{path.parent}:{stem.lower()}"
        if folder_key in seen_stems:
            continue
        seen_stems.add(folder_key)
        for suffix in _DUPLICATE_PART_SIDECARS:
            sibling = path.parent / f"{stem}{suffix}"
            if not sibling.is_file():
                continue
            if looks_like_mcmaster_part_stem(sibling.stem):
                continue
            rel = project_rel(root, sibling)
            dest_dir = trash / Path(rel).parent
            dest_dir.mkdir(parents=True, exist_ok=True)
            dest = dest_dir / sibling.name
            n = 2
            while dest.exists():
                dest = dest_dir / f"{sibling.stem}__dup{n}{sibling.suffix}"
                n += 1
            try:
                shutil.move(str(sibling), str(dest))
                moved.append(rel)
            except OSError:
                skipped.append(rel)
    if moved:
        try:
            log_path = trash / "manifest.jsonl"
            log_path.parent.mkdir(parents=True, exist_ok=True)
            with log_path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps({"project": root.name, "moved": moved, "count": len(moved)}) + "\n")
        except OSError:
            pass
    return {"project": root.name, "moved": moved, "skipped": skipped, "count": len(moved)}


def _is_exploded_assembly_sidecar_stem(stem: str, project_path: Path) -> bool:
    """Hide ``{base}_exploded`` previews when the assembled parent still exists.

    Exploded layouts are toggled from the viewport Exploded control — they must
    not appear as tiny sibling components beside the assembled model.
    """
    if not stem.lower().endswith("_exploded"):
        return False
    parent = stem[: -len("_exploded")]
    if not parent:
        return False
    return _parent_assembly_exists(project_path, parent)


def _exploded_sidecar_for_stem(project_path: Path, stem: str) -> str | None:
    """Return viewer filename for ``{stem}_exploded`` when present."""
    candidates: list[str] = []
    for base in (stem, _logical_component_root(stem)):
        text = str(base or "").strip()
        if not text:
            continue
        exploded_stem = text if text.lower().endswith("_exploded") else f"{text}_exploded"
        if exploded_stem not in candidates:
            candidates.append(exploded_stem)
    for exploded_stem in candidates:
        for ext in (".glb", ".gltf", ".step", ".stp", ".3mf"):
            path = project_path / f"{exploded_stem}{ext}"
            if path.is_file() and path.stat().st_size > 0:
                return viewer_filename_for_model(path.name, project_path)
    return None


def _body_children_from_part_sidecars(
    project_path: Path,
    *,
    parent_stem: str,
    parent_name: str,
    parent_viewer: str,
) -> list[dict[str, Any]]:
    """Nest ``_partNN`` / ``__part_NN_`` sidecars as Bodies under the parent component.

    Matches against the logical root stem so ``foo_edited`` still finds ``foo__part_*``.
    """
    roots = []
    for candidate in (parent_stem, _logical_component_root(parent_stem)):
        text = str(candidate or "").strip()
        if text and text not in roots:
            roots.append(text)
    best: dict[int, tuple[int, Path, str]] = {}
    from backend.services.engine_layout import ENGINE_FOLDERS as _ENGINE_FOLDERS, project_rel
    search_dirs = [project_path]
    parent_dir = Path(str(parent_name or "")).parent
    if str(parent_dir) not in {".", ""}:
        search_dirs.append(project_path / parent_dir)
    search_dirs.extend(project_path / folder for folder in _ENGINE_FOLDERS)
    seen_dirs: set[str] = set()
    glb_paths: list[Path] = []
    for directory in search_dirs:
        key = str(directory)
        if key in seen_dirs or not directory.is_dir():
            continue
        seen_dirs.add(key)
        glb_paths.extend(directory.glob("*.glb"))
    for root in roots:
        compact = re.compile(rf"^{re.escape(root)}_part(\d+)(?:_(\d+))?$", re.I)
        detailed = re.compile(rf"^{re.escape(root)}__part_(\d+)_(.+)$", re.I)
        for path in glb_paths:
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
                raw = re.sub(r"_+", " ", match.group(2)).strip() or f"Body {num}"
                label = " ".join(part.capitalize() for part in raw.split())
                prev = best.get(num)
                if prev is None or 0 >= prev[0]:
                    best[num] = (0, path, label[:96])
    if len(best) <= 1:
        return []
    ordered_nums = sorted(best)
    raw_labels = [best[num][2] for num in ordered_nums]
    viewer_path = Path(project_path) / str(parent_viewer or parent_name)
    occ = _sibling_step_occurrence_names(project_path, viewer_path, parent_name)
    authored = _sibling_authored_body_names(project_path, viewer_path, parent_name)
    labels = _display_names_for_scene_bodies(raw_labels, occ, authored)
    if _all_generic_browser_body_labels(labels):
        return []
    children: list[dict[str, Any]] = []
    for idx, num in enumerate(ordered_nums):
        _rev, path, fallback = best[num]
        label = labels[idx] if idx < len(labels) else fallback
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
                # Part file number (1-based) — viewport GLB fragments are often named
                # ``1_*`` / ``2_*`` / … matching this, not the 0-based body_index alone.
                "part_number": int(num),
                "sidecar_filename": project_rel(project_path, path),
                "virtual_body": True,
            }
        )
    return children


_SCENE_BODY_CHILDREN_CACHE: dict[str, tuple[float, list[dict[str, Any]]]] = {}
_SCENE_BODY_CHILDREN_CACHE_MAX = 128
_MAX_BROWSER_SCENE_BODIES = 256


def _logical_body_name_key(name: str) -> str:
    """Collapse Jake fragment names that differ only by a trailing hash."""
    text = str(name or "").strip().lower()
    if not text:
        return ""
    # Prefer the primary body token before face/feature annotations.
    if "|" in text:
        text = text.split("|", 1)[0].strip()
    text = re.sub(r"_[0-9a-f]{5,10}$", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _is_generic_gltf_body_id(name: str) -> bool:
    """True for tessellation placeholders, not authored CAD labels.

    OCC/RWGltf and recovered Bodies-from-GLB meshes often land as ``Body 30`` /
    ``Body_1`` / ``{stem} body`` even when the sibling STEP has real names.
    Jake cadpy uses occurrence ids (``o1``, ``o1.16``) plus ``mesh_0``.
    """
    raw = str(name or "").strip()
    if not raw:
        return True
    if raw.lower().startswith("mesh_"):
        return True
    if re.fullmatch(r"o\d+(?:\.\d+)*", raw, flags=re.I):
        return True
    if re.fullmatch(r"(?:body|part)[\s_-]*\d+", raw, flags=re.I):
        return True
    # OCC XCAF free-shape label: "Enclosure_Name body" / "Enclosure_Name body 3".
    return bool(re.search(r"[\s]body(?:\s+\d+)?$", raw, flags=re.I))


def _jake_occurrence_leaf_id(name: str) -> int | None:
    """Extract the leaf occurrence number from ``o1.16`` / ``o1.2.3`` style ids."""
    raw = str(name or "").strip()
    match = re.fullmatch(r"o\d+(?:\.(\d+))+", raw, flags=re.I)
    if not match:
        match = re.fullmatch(r"o(\d+)", raw, flags=re.I)
        if not match:
            return None
        return int(match.group(1))
    return int(match.group(1))


def _generic_body_index(name: str) -> int | None:
    """1-based Body/Part/o1.N index when the label is a tessellation placeholder."""
    raw = str(name or "").strip()
    leaf = _jake_occurrence_leaf_id(raw)
    if leaf is not None:
        return leaf
    match = re.fullmatch(r"(?:body|part)[\s_-]*(\d+)", raw, flags=re.I)
    if match:
        return int(match.group(1))
    match = re.search(r"[\s]body\s+(\d+)$", raw, flags=re.I)
    if match:
        return int(match.group(1))
    return None


def _humanize_body_label(raw: str) -> str:
    """Turn ``front_cover`` / ``pivot-pin-R`` into a short tree label."""
    text = " ".join(str(raw or "").replace("-", "_").replace("|", " ").split()).strip()
    if not text:
        return ""
    if _is_generic_gltf_body_id(text):
        return text
    parts = re.split(r"[_\s]+", text)
    return " ".join(part[:1].upper() + part[1:] if part else "" for part in parts if part)[:96]


def _step_assembly_occurrence_names(step_path: Path) -> dict[int, str]:
    """Map STEP ``NEXT_ASSEMBLY_USAGE_OCCURRENCE`` id → part name (base, front_cover, …)."""
    try:
        text = Path(step_path).read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return {}
    out: dict[int, str] = {}
    for occ_id, name in re.findall(
        r"NEXT_ASSEMBLY_USAGE_OCCURRENCE\(\s*'(\d+)'\s*,\s*'([^']*)'",
        text,
    ):
        try:
            key = int(occ_id)
        except ValueError:
            continue
        label = " ".join(str(name or "").split()).strip()
        if label and key not in out:
            out[key] = label
    return out


def _step_product_part_names(step_path: Path) -> list[str]:
    """Unique STEP ``PRODUCT`` names, dropping the assembly root when it matches the file stem."""
    try:
        text = Path(step_path).read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return []
    products: list[str] = []
    seen: set[str] = set()
    for ident, desc in re.findall(r"PRODUCT\(\s*'([^']*)'\s*,\s*'([^']*)'", text):
        label = " ".join(str(desc or ident or "").split()).strip()
        key = label.lower()
        if not label or key in seen:
            continue
        seen.add(key)
        products.append(label)
    if len(products) <= 1:
        return products
    stem_key = re.sub(r"[^a-z0-9]+", "", Path(step_path).stem.lower())
    first_key = re.sub(r"[^a-z0-9]+", "", products[0].lower())
    if stem_key and first_key and (first_key == stem_key or first_key.startswith(stem_key) or stem_key.startswith(first_key)):
        return products[1:]
    return products


def _authored_step_body_names(step_path: Path) -> list[str]:
    """Best authored solid labels from STEP: named BREPs, then occurrences, then PRODUCTs.

    Cadpy/Jake often leave ``MANIFOLD_SOLID_BREP('')`` empty and store names on
    ``NEXT_ASSEMBLY_USAGE_OCCURRENCE`` / ``PRODUCT`` instead. OCC tessellation then
    writes ``Body N`` into the GLB.
    """
    manifold = _step_manifold_solid_names(step_path)
    real_manifold = [name for name in manifold if name and not _is_generic_gltf_body_id(name)]
    if real_manifold and len(real_manifold) == len(manifold):
        return manifold
    occ = _step_assembly_occurrence_names(step_path)
    if occ:
        return [occ[key] for key in sorted(occ)]
    products = _step_product_part_names(step_path)
    if products:
        return products
    return real_manifold or manifold


def _viewer_logical_stem(glb_path: Path, parent_name: str = "") -> str:
    """Component stem for a viewer GLB, including Jake ``.{stem}.step.glb`` sidecars."""
    name = str(Path(glb_path).name or "")
    if name.startswith(".") and name.lower().endswith(".step.glb"):
        return name[1 : -len(".step.glb")]
    parent = Path(parent_name or "")
    if parent.suffix.lower() in {".step", ".stp", ".glb", ".gltf"} and parent.stem:
        stem = parent.stem
        if stem.startswith("."):
            stem = stem.lstrip(".")
        return _logical_component_root(stem) or stem
    stem = Path(glb_path).stem
    if stem.startswith(".") and (stem.endswith(".step") or stem.endswith(".stp")):
        return stem[1:].rsplit(".", 1)[0]
    return _logical_component_root(stem) or stem


def _sibling_step_paths(project_path: Path, glb_path: Path, parent_name: str) -> list[Path]:
    """STEP/STP files that belong to this viewer, including Jake hidden previews."""
    candidates: list[Path] = []
    parent = Path(parent_name or "")
    if parent.suffix.lower() in {".step", ".stp"}:
        candidates.append(Path(project_path) / parent.name)
    stems: list[str] = []
    for value in (
        _viewer_logical_stem(glb_path, parent_name),
        Path(glb_path).stem,
        parent.stem,
        _logical_component_root(Path(glb_path).stem),
        _logical_component_root(parent.stem),
    ):
        text = str(value or "").strip()
        if text.startswith(".") and text.endswith(".step"):
            text = text[1 : -len(".step")]
        if text and text not in stems:
            stems.append(text)
    for stem in stems:
        for ext in (".step", ".stp"):
            candidates.append(Path(project_path) / f"{stem}{ext}")
    seen: set[str] = set()
    out: list[Path] = []
    for path in candidates:
        key = str(path)
        if key in seen or not path.is_file():
            continue
        seen.add(key)
        out.append(path)
    return out


def _sibling_step_occurrence_names(
    project_path: Path,
    glb_path: Path,
    parent_name: str,
) -> dict[int, str]:
    """Load assembly occurrence names from a sibling STEP without OCC."""
    max_text_bytes = 8_000_000
    for step_path in _sibling_step_paths(project_path, glb_path, parent_name):
        try:
            if step_path.stat().st_size > max_text_bytes:
                continue
        except OSError:
            continue
        names = _step_assembly_occurrence_names(step_path)
        if names:
            return names
    return {}


def _sibling_authored_body_names(
    project_path: Path,
    glb_path: Path,
    parent_name: str,
) -> list[str]:
    """STEP entity names, then VibeCAD/Python ``expected_outputs``, for this viewer."""
    max_text_bytes = 8_000_000
    for step_path in _sibling_step_paths(project_path, glb_path, parent_name):
        try:
            if step_path.stat().st_size > max_text_bytes:
                continue
        except OSError:
            continue
        names = [name for name in _authored_step_body_names(step_path) if name and not _is_generic_gltf_body_id(name)]
        if names:
            return names
    return _sibling_expected_output_names(project_path, _viewer_logical_stem(glb_path, parent_name))


def _sibling_expected_output_names(project_path: Path, stem: str) -> list[str]:
    """VibeCAD / Codex ``expected_outputs`` (Python solid labels) for a model stem."""
    want = re.sub(r"[^a-z0-9]+", "", str(stem or "").lower())
    if not want:
        return []
    root = Path(project_path)
    files = list(root.glob("*.vibecad.json"))
    for folder in ("vibecad", "jake", "codex"):
        extra = root / folder
        if extra.is_dir():
            files.extend(extra.glob("*.vibecad.json"))
    best: list[str] = []
    best_score = 0
    for path in files:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(data, dict):
            continue
        outputs = [str(item).strip() for item in (data.get("expected_outputs") or []) if str(item).strip()]
        if not outputs:
            continue
        model = str(data.get("model_name") or path.stem or "")
        key = re.sub(r"[^a-z0-9]+", "", model.lower())
        file_key = re.sub(r"[^a-z0-9]+", "", path.stem.lower())
        score = 0
        if key and (key == want or want.startswith(key) or key.startswith(want)):
            score = max(len(key), 1)
        elif file_key and (file_key == want or want.startswith(file_key) or file_key.startswith(want)):
            score = max(len(file_key) // 2, 1)
        if score > best_score:
            best_score = score
            best = outputs
    return best


def _display_names_for_scene_bodies(
    raw_names: list[str],
    occurrence_names: dict[int, str] | None = None,
    authored_names: list[str] | None = None,
) -> list[str]:
    """Prefer STEP occurrence / cadName / Python solid labels; else ``Part N``.

    Jake GLBs often store node.name as occurrence ids (``o1.16``). OCC previews
    and recovered Bodies-from-GLB meshes use ``Body 30``. Real CAD names live in
    sibling STEP ``NEXT_ASSEMBLY_USAGE_OCCURRENCE`` / ``PRODUCT`` rows, GLB cadName,
    or VibeCAD ``expected_outputs``.
    """
    occ = dict(occurrence_names or {})
    ordered_occ = [occ[k] for k in sorted(occ)]
    authored = [str(name).strip() for name in (authored_names or []) if str(name).strip() and not _is_generic_gltf_body_id(str(name))]
    zip_pool = authored if authored else ordered_occ
    # When leaf ids don't match STEP ids (exploded assemblies renumber 17..32),
    # zip sorted occurrence leaves to sorted STEP names.
    leaf_pairs: list[tuple[int, int]] = []
    for idx, raw in enumerate(raw_names):
        leaf = _generic_body_index(raw) if _is_generic_gltf_body_id(raw) else _jake_occurrence_leaf_id(raw)
        if leaf is not None:
            leaf_pairs.append((leaf, idx))
    order_map: dict[int, str] = {}
    if zip_pool and len(leaf_pairs) == len(zip_pool) == len(raw_names):
        leaf_pairs.sort(key=lambda item: item[0])
        for occ_name, (_leaf, idx) in zip(zip_pool, leaf_pairs):
            order_map[idx] = occ_name

    mapped: list[str | None] = [None] * len(raw_names)
    used: set[str] = set()
    for idx, raw in enumerate(raw_names):
        label = str(raw or "").strip()
        if "|" in label:
            label = label.split("|", 1)[0].strip() or label
        if not _is_generic_gltf_body_id(label) and label:
            mapped[idx] = label
            used.add(_logical_body_name_key(label))
            continue
        leaf = _generic_body_index(label)
        choice = ""
        if leaf is not None and leaf in occ:
            choice = occ[leaf]
        elif idx in order_map:
            choice = order_map[idx]
        elif leaf is None and label:
            # Assembly wrapper ("Foo body") — keep a cleaned component title.
            cleaned = re.sub(r"[\s_-]*body(?:[\s_-]*\d+)?$", "", label, flags=re.I).strip(" _-")
            if cleaned and not _is_generic_gltf_body_id(cleaned):
                choice = cleaned
        if choice:
            mapped[idx] = choice
            used.add(_logical_body_name_key(choice))

    unused = [name for name in zip_pool if _logical_body_name_key(name) not in used]
    unused_i = 0
    out: list[str] = []
    for idx, raw in enumerate(raw_names):
        label = mapped[idx] or ""
        if not label or _is_generic_gltf_body_id(label):
            if unused_i < len(unused):
                label = unused[unused_i]
                unused_i += 1
            else:
                label = f"Part {idx + 1}"
        out.append(_humanize_body_label(label) or f"Part {idx + 1}")
    return out


def _all_generic_browser_body_labels(labels: list[str]) -> bool:
    """True when every body name is a tessellation placeholder, not a unique part."""
    if not labels:
        return False
    for label in labels:
        text = str(label or "").strip()
        if not text:
            continue
        if _is_generic_gltf_body_id(text):
            continue
        slug = re.sub(r"[^a-zA-Z0-9]+", "_", text).strip("_").lower()
        if is_generic_promoted_part_slug(slug):
            continue
        return False
    return True


def _scene_names_are_single_logical_body(names: list[str]) -> bool:
    """True when GLB scene nodes are mesh fragments of one part, not distinct bodies."""
    keys = {key for name in names if (key := _logical_body_name_key(name))}
    return len(keys) <= 1


def _sibling_step_solid_count(project_path: Path, glb_path: Path, parent_name: str) -> int | None:
    """Return STEP solid count when a sibling STEP exists; None if unknown.

    Avoids OCC mesh extraction on large STEP files — that path can peg a worker
    for minutes and starve HTTP (models stuck spinning on project open).
    """
    # Text-scan only; skip huge STEP files (threaded rods / assemblies).
    max_text_bytes = 4_000_000
    for step_path in _sibling_step_paths(project_path, glb_path, parent_name):
        try:
            if step_path.stat().st_size > max_text_bytes:
                continue
        except OSError:
            continue
        try:
            authored = [
                name
                for name in _authored_step_body_names(step_path)
                if name and not _is_generic_gltf_body_id(name)
            ]
            if authored:
                return len(authored)
            names = _step_manifold_solid_names(step_path)
            if names:
                return len(names)
        except Exception:
            pass
    return None


def _glb_scene_mesh_names_fast(path: Path) -> list[str]:
    """Read mesh/node labels from a GLB JSON chunk without loading geometry.

    Used by the project browser so a wedged trimesh/OCC parse cannot block HTTP.
    """
    path = Path(path)
    try:
        from backend.services.json_finite import loads_finite, read_glb_json_chunk_bytes

        raw = read_glb_json_chunk_bytes(path)
        if not raw:
            return []
        meta = loads_finite(raw.decode("utf-8"))
    except Exception:
        return []
    if not isinstance(meta, dict):
        return []
    names: list[str] = []
    meshes = meta.get("meshes") or []
    nodes = meta.get("nodes") or []
    # Prefer named nodes that reference a mesh.
    for node in nodes:
        if not isinstance(node, dict):
            continue
        if node.get("mesh") is None:
            continue
        extras = node.get("extras") if isinstance(node.get("extras"), dict) else {}
        cad_name = str((extras or {}).get("cadName") or "").strip()
        node_name = str(node.get("name") or "").strip()
        # Prefer human CAD name when Jake stored the occurrence id in name.
        if cad_name and (_is_generic_gltf_body_id(node_name) or not node_name):
            label = cad_name
        else:
            label = node_name or cad_name
        if label:
            names.append(label)
    if len(names) >= 2:
        return names
    # Fall back to mesh names.
    names = []
    for mesh in meshes:
        if not isinstance(mesh, dict):
            continue
        extras = mesh.get("extras") if isinstance(mesh.get("extras"), dict) else {}
        cad_name = str((extras or {}).get("cadName") or "").strip()
        mesh_name = str(mesh.get("name") or "").strip()
        label = cad_name if cad_name and _is_generic_gltf_body_id(mesh_name) else (mesh_name or cad_name)
        if label:
            names.append(label)
    return names


def _body_children_from_viewer_scene(
    project_path: Path,
    *,
    parent_stem: str,
    parent_name: str,
    parent_viewer: str,
) -> list[dict[str, Any]]:
    """Nest named GLB scene meshes as Bodies under the parent component.

    Skips Jake/cadpy mesh fragments of a single STEP solid — those look like
    many bodies in the GLB but are one part (hide/show would all affect the same plate).
    """
    viewer = str(parent_viewer or parent_name or "").strip()
    if not viewer:
        return []
    path = project_path / viewer
    if not path.is_file() or path.suffix.lower() not in {".glb", ".gltf"}:
        # Tombstoned public GLB: use the hidden Jake assembled viewer.
        jake = jake_viewport_glb_for_stem(project_path, parent_stem)
        if jake is not None and jake.is_file():
            path = jake
            viewer = jake.name
        else:
            # Fall back to a sibling .glb for STEP parents.
            stem = Path(parent_name or parent_stem).stem
            for ext in (".glb", ".gltf"):
                candidate = project_path / f"{stem}{ext}"
                if candidate.is_file():
                    path = candidate
                    viewer = candidate.name
                    break
            else:
                return []
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return []
    cache_key = f"v6bodynames:{path.resolve()}"
    cached = _SCENE_BODY_CHILDREN_CACHE.get(cache_key)
    if cached and cached[0] == mtime:
        return [dict(child) for child in cached[1]]

    # Jake CADJS `.{stem}.step.glb` is the assembled viewer after a catalog tombstone.
    # A sibling bracket-only STEP (one MANIFOLD_SOLID_BREP) must not wipe those meshes.
    jake_preview = str(path.name).startswith(".") and str(path.name).lower().endswith(".step.glb")
    if not jake_preview:
        step_count = _sibling_step_solid_count(project_path, path, parent_name)
        if step_count is not None and step_count <= 1:
            _SCENE_BODY_CHILDREN_CACHE[cache_key] = (mtime, [])
            return []

    # Fast JSON-only parse. Never call trimesh/OCC here — that path has wedged
    # workers for minutes on some large GLBs (project open spins forever).
    raw_names = [str(n or "").strip() for n in _glb_scene_mesh_names_fast(path)]
    count = len(raw_names)
    if count <= 1 or count > _MAX_BROWSER_SCENE_BODIES or _scene_names_are_single_logical_body(raw_names):
        _SCENE_BODY_CHILDREN_CACHE[cache_key] = (mtime, [])
        return []

    occurrence_names = _sibling_step_occurrence_names(project_path, path, parent_name)
    authored_names = _sibling_authored_body_names(project_path, path, parent_name)
    names = _display_names_for_scene_bodies(raw_names, occurrence_names, authored_names)
    if _all_generic_browser_body_labels(names):
        _SCENE_BODY_CHILDREN_CACHE[cache_key] = (mtime, [])
        return []

    children: list[dict[str, Any]] = []
    for idx in range(count):
        label = names[idx] if idx < len(names) else f"Part {idx + 1}"
        slug = re.sub(r"[^A-Za-z0-9]+", "_", label).strip("_").lower() or f"body_{idx + 1}"
        children.append(
            {
                "id": f"{parent_stem or Path(parent_name).stem}:body:{slug}:{idx + 1}",
                "name": f"{parent_name}#body:{idx + 1}",
                "filename": parent_name,
                "stem": slug,
                "label": label,
                "format": "body",
                "viewer_filename": viewer,
                "source_filename": parent_name,
                "parent_filename": parent_name,
                "body_index": idx,
                "body_name": label,
                "virtual_body": True,
            }
        )
    # OCC/recovered GLBs list Body 30..1; keep body_index as mesh order for viewport
    # picks, but show authored occurrence order (Body 1 / base first).
    if any(_generic_body_index(raw) is not None for raw in raw_names):
        children.sort(
            key=lambda child: (
                0 if _generic_body_index(raw_names[int(child.get("body_index") or 0)]) is not None else 1,
                _generic_body_index(raw_names[int(child.get("body_index") or 0)]) or 0,
            )
        )
    _SCENE_BODY_CHILDREN_CACHE[cache_key] = (mtime, children)
    if len(_SCENE_BODY_CHILDREN_CACHE) > _SCENE_BODY_CHILDREN_CACHE_MAX:
        for drop_key in list(_SCENE_BODY_CHILDREN_CACHE.keys())[: len(_SCENE_BODY_CHILDREN_CACHE) // 2]:
            _SCENE_BODY_CHILDREN_CACHE.pop(drop_key, None)
    return [dict(child) for child in children]


def _is_autodesk_source_stem(stem: str) -> bool:
    """Hidden Autodesk/Fusion conversion sidecars: ``.autodesk_source_<name>``."""
    return str(stem or "").startswith(".autodesk_source_")


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
        if _is_part_extension_sidecar_stem(stem, project_path):
            visible.discard(stem)

    for stem in list(visible):
        if _is_exploded_assembly_sidecar_stem(stem, project_path):
            visible.discard(stem)

    for stem in list(visible):
        if _is_jake_topology_sidecar_stem(stem):
            visible.discard(stem)

    for stem in list(visible):
        if _is_faceted_export_stem(stem):
            visible.discard(stem)

    for stem in list(visible):
        if _is_autodesk_source_stem(stem):
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
    """Return the main assembly browser entry, if any.

    Catalog McMaster fasteners are nested under Bodies, never Components, and
    are never the assembly the viewport auto-loads — they are inputs to mate.
    """
    canonical = _canonical_assembly_stem(project_path)
    comps = [
        c
        for c in (list_browser_tree(project_path).get("components") or [])
        if not c.get("catalog_hardware")
    ]
    for comp in comps:
        if comp.get("primary"):
            return comp
    if canonical:
        for comp in comps:
            if comp.get("stem") == canonical:
                return comp
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
    if _is_exploded_assembly_sidecar_stem(stem, project_path):
        parent = stem[: -len("_exploded")]
        for ext in (".glb", ".gltf", ".step", ".stp", ".3mf"):
            parent_path = project_path / f"{parent}{ext}"
            if parent_path.is_file():
                return viewer_filename_for_model(parent_path.name, project_path)
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

    located = resolve_project_file(project_path, filename)
    if (located is not None and located.is_file()) or (project_path / filename).is_file():
        resolved = viewer_filename_for_model(filename, project_path)
        if canonical and _is_prompt_artifact_stem(stem):
            glb = project_path / f"{canonical}.glb"
            if glb.is_file():
                return glb.name
        return resolved

    primary = primary_assembly_component(project_path)
    return primary["viewer_filename"] if primary else None


def _mcmaster_parts_folder(hardware: list[dict[str, Any]]) -> dict[str, Any]:
    """Virtual Bodies folder for catalog McMaster parts (not Components)."""
    return {
        "id": "mcmaster-parts",
        "name": "McMaster Parts",
        "label": "McMaster Parts",
        "stem": "mcmaster-parts",
        "virtual_folder": True,
        "catalog_hardware_folder": True,
        "children_label": "McMaster Parts",
        "children": list(hardware),
    }


def list_browser_tree(project_path: Path) -> dict[str, Any]:
    """Fusion-style browser sections for components, sketches, and wiring."""
    from backend.services.assembly_motion import browser_joints
    components: list[dict[str, Any]] = []
    sketches: list[dict[str, Any]] = []
    wiring_items: list[dict[str, Any]] = []
    rigging_items: list[dict[str, Any]] = []

    from backend.services.project_viewport_manifest import project_viewport_browser

    manifest = project_viewport_browser(project_path)
    components = manifest["components"]
    bodies_section = manifest["bodies"]
    designed = components

    # Nest exploded body sidecars under each designed component (cheap filesystem scan).
    # Fall back to named GLB scene meshes when no __part_ sidecars exist — scene
    # parse is fast; avoid load_mesh/OCC here (those can wedge workers).
    for comp in designed:
        children = _body_children_from_part_sidecars(
            project_path,
            parent_stem=str(comp.get("stem") or ""),
            parent_name=str(comp.get("name") or ""),
            parent_viewer=str(comp.get("viewer_filename") or comp.get("name") or ""),
        )
        if not children:
            children = _body_children_from_viewer_scene(
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

    from backend.services import imagine_service

    imagine_items = imagine_service.list_imagine_files(project_path)
    existing_names = {str(c.get("name") or "") for c in components}
    for item in imagine_items:
        if item.get("kind") != "cad":
            continue
        rel = str(item.get("name") or "")
        if not rel or rel in existing_names:
            continue
        components.append(
            {
                "id": item.get("stem") or Path(rel).stem,
                "name": rel,
                "stem": item.get("stem") or Path(rel).stem,
                "format": item.get("format"),
                "kind": "cad",
                "section": "imagine",
                "size": item.get("size"),
            }
        )
        existing_names.add(rel)

    return {
        "components": components,
        "joints": browser_joints(project_path),
        "bodies": bodies_section,
        "sketches": sketches,
        "wiring": wiring_items,
        "drawings": drawings,
        "references": list_reference_files(project_path),
        "renders": list_render_files(project_path),
        "imagine": imagine_items,
        "rigging": rigging_items,
        "robots": robots,
    }


def _mesh_len(obj: Any, attr: str) -> int:
    arr = getattr(obj, attr, None)
    if arr is None:
        return 0
    try:
        return int(len(arr))
    except Exception:
        return 0


def load_mesh(path: Path) -> trimesh.Trimesh:
    suffix = path.suffix.lower()
    if suffix in STEP_SUFFIXES:
        return repair_mesh(import_step_mesh(path))
    if suffix in IGES_SUFFIXES:
        return repair_mesh(import_iges_mesh(path))
    if suffix in BREP_SUFFIXES:
        return repair_mesh(import_brep_mesh(path))
    try:
        loaded = trimesh.load(path, force="mesh")
    except IndexError as exc:
        raise ValueError(f"Could not load mesh from {path.name}: empty geometry") from exc
    if isinstance(loaded, trimesh.Scene):
        loaded = _scene_to_single_mesh(loaded, path.name)
    if not isinstance(loaded, trimesh.Trimesh):
        raise ValueError(f"Could not load mesh from {path}")
    if _mesh_len(loaded, "faces") == 0 or _mesh_len(loaded, "vertices") == 0:
        raise ValueError(f"Model has no mesh faces to color: {path.name}")
    return repair_mesh(loaded)


def _iter_trimesh_geoms(obj: Any) -> list[trimesh.Trimesh]:
    found: list[trimesh.Trimesh] = []
    if isinstance(obj, trimesh.Trimesh):
        if _mesh_len(obj, "faces") and _mesh_len(obj, "vertices"):
            found.append(obj)
        return found
    if isinstance(obj, trimesh.Scene):
        try:
            dumped = obj.dump(concatenate=False)
        except Exception:
            dumped = list(obj.geometry.values()) if getattr(obj, "geometry", None) else []
        for geom in dumped:
            found.extend(_iter_trimesh_geoms(geom))
    return found


def _scene_to_single_mesh(scene: trimesh.Scene, name: str) -> trimesh.Trimesh:
    parts = _iter_trimesh_geoms(scene)
    if not parts:
        raise ValueError(f"Model has no mesh faces to color: {name}")
    if len(parts) == 1:
        return parts[0]
    try:
        combined = trimesh.util.concatenate(parts)
    except (IndexError, ValueError) as exc:
        raise ValueError(f"Could not combine mesh bodies from {name}") from exc
    if not isinstance(combined, trimesh.Trimesh) or len(combined.faces) == 0:
        raise ValueError(f"Model has no mesh faces to color: {name}")
    return combined


def load_scene(path: Path) -> trimesh.Scene:
    """Load a mesh/GLB/3MF as a scene, preserving separate named objects."""
    loaded = trimesh.load(path, force="scene")
    if isinstance(loaded, trimesh.Trimesh):
        scene = trimesh.Scene()
        scene.add_geometry(loaded, geom_name=path.stem, node_name=path.stem)
        return scene
    if not isinstance(loaded, trimesh.Scene):
        raise ValueError(f"Could not load scene from {path}")
    if Path(path).suffix.lower() == ".glb":
        _restore_glb_parent_world_transforms(loaded, Path(path))
    return loaded


def _restore_glb_parent_world_transforms(scene: trimesh.Scene, path: Path) -> None:
    """Restore hierarchy world matrices dropped by older trimesh GLB loaders.

    The viewport honors parent transforms. Some supported trimesh versions only
    retain transforms directly attached to mesh nodes, which made backend bounds
    and derivative exports disagree with the viewer after a lossless wrapper edit.
    """
    try:
        document, _version, _chunks = _read_glb_document(path)
        _scene, nodes, _parents, worlds = _gltf_scene_graph(document)
    except Exception:
        return
    available = [str(name) for name in scene.graph.nodes_geometry]
    used: set[str] = set()
    for node_index in _gltf_mesh_node_indices(document):
        node = nodes[node_index] or {}
        expected = str(node.get("name") or "")
        normalized = re.sub(r"[\s_]+", " ", expected.strip().lower())
        candidates = [name for name in available if name not in used and name == expected]
        if not candidates:
            candidates = [
                name
                for name in available
                if name not in used
                and re.sub(r"[\s_]+", " ", name.strip().lower()) == normalized
            ]
        if not candidates:
            continue
        actual = candidates[0]
        try:
            _old, geometry = scene.graph.get(actual)
            scene.graph.update(
                frame_from=scene.graph.base_frame,
                frame_to=actual,
                matrix=np.asarray(worlds[node_index], dtype=float),
                geometry=geometry,
            )
            used.add(actual)
        except Exception:
            continue


_CAD_VERTEX_ABS_LIMIT = 1e9  # 1000 km in mm; anything larger is tessellation garbage


def sanitize_trimesh_finite(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    """Drop or zero non-finite / overflowed vertices so GLB JSON never serializes Infinity."""
    if not isinstance(mesh, trimesh.Trimesh) or getattr(mesh, "is_empty", False):
        return mesh
    verts = np.asarray(mesh.vertices, dtype=float)
    if verts.size == 0:
        return mesh
    finite_rows = np.isfinite(verts).all(axis=1) & (np.abs(verts) < _CAD_VERTEX_ABS_LIMIT).all(axis=1)
    if finite_rows.all():
        return mesh
    faces = np.asarray(mesh.faces, dtype=int) if getattr(mesh, "faces", None) is not None else np.empty((0, 3), dtype=int)
    if finite_rows.any() and len(faces):
        keep = finite_rows[faces].all(axis=1)
        if keep.any() and not bool(keep.all()):
            try:
                mesh.update_faces(np.nonzero(keep)[0])
                mesh.remove_unreferenced_vertices()
            except Exception:
                pass
            verts = np.asarray(mesh.vertices, dtype=float)
            finite_rows = np.isfinite(verts).all(axis=1) & (np.abs(verts) < _CAD_VERTEX_ABS_LIMIT).all(axis=1)
    if verts.size and not finite_rows.all():
        cleaned = np.where(np.isfinite(verts) & (np.abs(verts) < _CAD_VERTEX_ABS_LIMIT), verts, 0.0)
        mesh.vertices = cleaned
    return mesh


def sanitize_scene_finite(scene: trimesh.Scene) -> trimesh.Scene:
    if not isinstance(scene, trimesh.Scene):
        return scene
    for geom in list(scene.geometry.values()):
        if isinstance(geom, trimesh.Trimesh):
            sanitize_trimesh_finite(geom)
    return scene


def export_scene(scene: trimesh.Scene, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.suffix.lower() == ".3mf":
        return export_scene_3mf(scene, path)
    if path.suffix.lower() == ".obj":
        from trimesh.exchange.obj import export_obj

        obj_text, companions = export_obj(
            scene,
            include_normals=True,
            include_color=True,
            include_texture=True,
            return_texture=True,
            write_texture=False,
            mtl_name=path.with_suffix(".mtl").name,
        )
        path.write_text(obj_text, encoding="utf-8")
        for raw_name, payload in companions.items():
            safe_name = Path(str(raw_name)).name
            if safe_name:
                (path.parent / safe_name).write_bytes(payload if isinstance(payload, bytes) else str(payload).encode("utf-8"))
        return path
    suffix = path.suffix.lower().lstrip(".")
    if suffix in {"glb", "gltf"}:
        sanitize_scene_finite(scene)
        try:
            scene.export(str(path), file_type=suffix, include_normals=True)
        except TypeError:
            scene.export(str(path), file_type=suffix)
        from backend.services.json_finite import rewrite_glb_finite_json

        rewrite_glb_finite_json(path)
        return path
    scene.export(str(path), file_type=suffix)
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


def _mesh_declared_unit_scale_to_mm(mesh: trimesh.Trimesh) -> float:
    """Return a scale only when the mesh carries an explicit length unit.

    Render Studio's workspace and generated GLBs use millimeter coordinates even
    though glTF has no unit field. Extent-based guesses corrupt legitimate
    sub-millimeter parts, so an undeclared unit is treated as workspace mm.
    """
    raw = getattr(mesh, "units", None) or getattr(mesh, "metadata", {}).get("units")
    unit = str(raw or "").strip().lower().replace("metres", "meters").replace("metre", "meter")
    scales = {
        "mm": 1.0,
        "millimeter": 1.0,
        "millimeters": 1.0,
        "cm": 10.0,
        "centimeter": 10.0,
        "centimeters": 10.0,
        "m": 1000.0,
        "meter": 1000.0,
        "meters": 1000.0,
        "in": 25.4,
        "inch": 25.4,
        "inches": 25.4,
    }
    return scales.get(unit, 1.0)


def _prepare_mesh_for_3mf(
    raw_mesh: trimesh.Trimesh,
    *,
    unit_scale_to_mm: float | None = None,
) -> trimesh.Trimesh | None:
    """Repair, normalize explicitly declared units to mm, weld, and sanitize."""
    if not isinstance(raw_mesh, trimesh.Trimesh) or raw_mesh.is_empty:
        return None
    mesh = repair_mesh(raw_mesh.copy())
    unit_scale = (
        float(unit_scale_to_mm)
        if unit_scale_to_mm is not None
        else _mesh_declared_unit_scale_to_mm(raw_mesh)
    )
    if abs(unit_scale - 1.0) > 1e-12:
        mesh.apply_scale(unit_scale)
    try:
        mesh.update_faces(mesh.nondegenerate_faces())
    except AttributeError:
        mesh.remove_degenerate_faces()
    mesh.remove_unreferenced_vertices()
    mesh.merge_vertices()
    mesh.fix_normals()
    verts = np.asarray(mesh.vertices, dtype=float)
    if verts.size and not np.isfinite(verts).all():
        mesh.vertices = np.nan_to_num(verts, nan=0.0, posinf=0.0, neginf=0.0)
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


def _seat_mesh_on_bambu_plate(
    mesh: trimesh.Trimesh,
    *,
    bed_w: float = THREEMF_BAMBU_BED_W,
    bed_d: float = THREEMF_BAMBU_BED_D,
) -> trimesh.Trimesh:
    """Seat one body on a single plate: Z=0, XY centered on the bed."""
    copy = mesh.copy()
    bounds = np.asarray(copy.bounds, dtype=float)
    lo, hi = bounds[0], bounds[1]
    shift = np.array(
        [
            0.5 * bed_w - 0.5 * (lo[0] + hi[0]),
            0.5 * bed_d - 0.5 * (lo[1] + hi[1]),
            -float(lo[2]),
        ],
        dtype=float,
    )
    copy.apply_translation(shift)
    return copy


def _bambu_plate_cols(count: int) -> int:
    value = math.sqrt(max(int(count), 1))
    round_value = round(value)
    if value > round_value:
        return int(round_value) + 1
    return max(int(round_value), 1)


def _bambu_plate_origin(index: int, count: int) -> tuple[float, float]:
    cols = _bambu_plate_cols(count)
    row, col = divmod(int(index), cols)
    stride_x = THREEMF_BAMBU_BED_W * (1.0 + THREEMF_BAMBU_PLATE_GAP)
    stride_y = THREEMF_BAMBU_BED_D * (1.0 + THREEMF_BAMBU_PLATE_GAP)
    return col * stride_x, -row * stride_y


def _transform_12_from_matrix(matrix: np.ndarray) -> str:
    m = np.asarray(matrix, dtype=float)
    vals = [
        m[0, 0], m[0, 1], m[0, 2],
        m[1, 0], m[1, 1], m[1, 2],
        m[2, 0], m[2, 1], m[2, 2],
        m[0, 3], m[1, 3], m[2, 3],
    ]
    return " ".join(_fmt_float(float(v)) for v in vals)


def _translation_transform(tx: float, ty: float, tz: float = 0.0) -> str:
    return f"1 0 0 0 1 0 0 0 1 {_fmt_float(tx)} {_fmt_float(ty)} {_fmt_float(tz)}"


def _meshes_from_scene(
    scene: trimesh.Scene,
    *,
    source_path: Path | None = None,
) -> list[tuple[str, trimesh.Trimesh]]:
    """Extract world-space meshes from a scene graph (preserves assembly transforms).

    Order matches Three.js / glTF scene children when ``source_path`` is a GLB.
    """
    items: list[tuple[str, trimesh.Trimesh]] = []
    try:
        entries = _scene_geometry_entries(scene, source_path=source_path)
        for node_name, geom_name, geom, world in entries:
            if not isinstance(geom, trimesh.Trimesh):
                continue
            mesh = geom.copy()
            if world is not None and not np.allclose(world, np.eye(4)):
                mesh.apply_transform(np.asarray(world, dtype=float))
            label = _safe_object_name(node_name or geom_name, f"part_{len(items) + 1}")
            mesh.metadata["node"] = label
            mesh.metadata["name"] = label
            items.append((label, mesh))
    except Exception as exc:
        logger.debug("scene graph extraction failed, falling back to dump: %s", exc)
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


def _append_3mf_mesh_geometry(mesh_el: ET.Element, mesh: trimesh.Trimesh) -> None:
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


def _mesh_3mf_display_color(mesh: trimesh.Trimesh) -> str | None:
    """Return one authored part color for 3MF base-material preservation."""
    rgba = _dominant_rgba(mesh)
    if rgba is None:
        return None
    values = np.asarray(rgba, dtype=np.uint8).reshape(-1)
    if values.size < 3:
        return None
    alpha = int(values[3]) if values.size > 3 else 255
    return "#" + "".join(f"{int(value):02X}" for value in (*values[:3], alpha))


def _append_3mf_base_material(
    resources: ET.Element,
    mesh: trimesh.Trimesh,
    *,
    resource_id: int,
) -> tuple[int, int] | None:
    color = _mesh_3mf_display_color(mesh)
    if not color:
        return None
    group = ET.SubElement(
        resources,
        f"{{{THREEMF_CORE_NS}}}basematerials",
        {"id": str(resource_id)},
    )
    ET.SubElement(
        group,
        f"{{{THREEMF_CORE_NS}}}base",
        {"name": "Render Studio appearance", "displaycolor": color},
    )
    return resource_id, 0


def _append_3mf_mesh_object(
    resources: ET.Element,
    build: ET.Element,
    *,
    object_id: int,
    name: str,
    mesh: trimesh.Trimesh,
    transform: str = THREEMF_IDENTITY_TRANSFORM,
) -> None:
    obj_attrs = {
        "id": str(object_id),
        "type": "model",
        "name": name,
        f"{{{THREEMF_PRODUCTION_NS}}}UUID": str(uuid.uuid4()),
    }
    material = _append_3mf_base_material(resources, mesh, resource_id=object_id + 1_000_000)
    if material is not None:
        obj_attrs["pid"] = str(material[0])
        obj_attrs["pindex"] = str(material[1])
    obj = ET.SubElement(resources, f"{{{THREEMF_CORE_NS}}}object", obj_attrs)
    mesh_el = ET.SubElement(obj, f"{{{THREEMF_CORE_NS}}}mesh")
    _append_3mf_mesh_geometry(mesh_el, mesh)
    ET.SubElement(
        build,
        f"{{{THREEMF_CORE_NS}}}item",
        {
            "objectid": str(object_id),
            "transform": transform,
            "partnumber": name,
            f"{{{THREEMF_PRODUCTION_NS}}}UUID": str(uuid.uuid4()),
        },
    )


def _bambu_hex_uuid(index: int, suffix: str) -> str:
    return f"{int(index) & 0xFFFFFFFF:08x}{suffix}"


def _bambu_project_settings_bytes(*, enable_support: bool | None = None) -> bytes:
    """Minimal-but-complete Bambu project_settings so Studio opens as a real project."""
    raw: bytes | None = None
    try:
        raw = _BAMBU_PROJECT_SETTINGS_PATH.read_bytes()
        if raw.strip():
            pass
        else:
            raw = None
    except OSError as exc:
        logger.warning("missing bambu project_settings template: %s", exc)
    if raw is None:
        # Fallback: enough keys for DynamicPrintConfig to be non-empty.
        fallback = {
            "version": "01.10.00.87",
            "printer_model": "Bambu Lab X1 Carbon",
            "printer_settings_id": "Bambu Lab X1 Carbon 0.4 nozzle",
            "print_settings_id": "0.20mm Standard @BBL X1C",
            "filament_settings_id": ["Generic PLA"],
            "filament_type": ["PLA"],
            "filament_colour": ["#00AE42"],
            "nozzle_diameter": ["0.4"],
            "printable_area": ["0x0", "256x0", "256x256", "0x256"],
            "printable_height": "250",
            "curr_bed_type": "Textured PEI Plate",
            "enable_support": "0",
            "support_type": "normal(auto)",
            "support_threshold_angle": "30",
        }
        raw = (json.dumps(fallback, indent=4) + "\n").encode("utf-8")
    if enable_support is None:
        return raw
    try:
        settings = json.loads(raw.decode("utf-8"))
        settings["enable_support"] = "1" if enable_support else "0"
        settings.setdefault("support_type", "normal(auto)")
        settings.setdefault("support_threshold_angle", "30")
        return (json.dumps(settings, indent=4) + "\n").encode("utf-8")
    except (UnicodeDecodeError, json.JSONDecodeError, TypeError) as exc:
        logger.warning("could not set automatic Bambu support preference: %s", exc)
        return raw


def apply_print_profile_to_3mf(path: Path, profile: dict | None) -> bool:
    """Rewrite Metadata/project_settings.config filament + supports. Auth is the caller's job."""
    if not profile or not path or not Path(path).is_file():
        return False
    filament = str(profile.get("filament") or "").strip()
    supports = profile.get("supports_enabled")
    if not filament and supports is None:
        return False
    import io
    import zipfile

    src = Path(path)
    buf = io.BytesIO()
    changed = False
    try:
        with zipfile.ZipFile(src, "r") as zin, zipfile.ZipFile(buf, "w") as zout:
            for item in zin.infolist():
                data = zin.read(item.filename)
                name = str(item.filename or "")
                if name.endswith("project_settings.config") or name.endswith("project_settings.json"):
                    try:
                        obj = json.loads(data.decode("utf-8"))
                        if filament:
                            obj["filament_type"] = [filament]
                            obj["filament_settings_id"] = [f"Generic {filament}"]
                        if supports is not None:
                            obj["enable_support"] = "1" if supports else "0"
                        data = (json.dumps(obj, indent=4) + "\n").encode("utf-8")
                        changed = True
                    except Exception:
                        pass
                zout.writestr(item, data)
        if changed:
            src.write_bytes(buf.getvalue())
    except Exception as exc:
        logger.warning("print profile 3MF patch skipped: %s", exc)
        return False
    return changed


def _build_object_model_xml(
    mesh: trimesh.Trimesh,
    *,
    mesh_object_id: int = 1,
    file_index: int = 1,
) -> bytes:
    model = ET.Element(
        f"{{{THREEMF_CORE_NS}}}model",
        {
            "unit": "millimeter",
            "{http://www.w3.org/XML/1998/namespace}lang": "en-US",
            "requiredextensions": "p",
        },
    )
    ET.SubElement(model, f"{{{THREEMF_CORE_NS}}}metadata", {"name": "BambuStudio:3mfVersion"}).text = "1"
    resources = ET.SubElement(model, f"{{{THREEMF_CORE_NS}}}resources")
    obj_attrs = {
            "id": str(mesh_object_id),
            "type": "model",
            f"{{{THREEMF_PRODUCTION_NS}}}UUID": _bambu_hex_uuid(
                file_index, THREEMF_BAMBU_SUBOBJECT_UUID_SUFFIX
            ),
        }
    material = _append_3mf_base_material(resources, mesh, resource_id=mesh_object_id + 1_000_000)
    if material is not None:
        obj_attrs["pid"] = str(material[0])
        obj_attrs["pindex"] = str(material[1])
    obj = ET.SubElement(resources, f"{{{THREEMF_CORE_NS}}}object", obj_attrs)
    mesh_el = ET.SubElement(obj, f"{{{THREEMF_CORE_NS}}}mesh")
    _append_3mf_mesh_geometry(mesh_el, mesh)
    ET.SubElement(model, f"{{{THREEMF_CORE_NS}}}build")
    return _xml_bytes(model)


def _build_bambu_model_settings(
    bodies: list[dict[str, Any]],
) -> str:
    """Bambu Studio Metadata/model_settings.config — one plate entry per plate id."""
    lines = ['<?xml version="1.0" encoding="UTF-8"?>', "<config>"]
    for body in bodies:
        oid = int(body["object_id"])
        part_id = int(body.get("part_id") or 1)
        name = str(body["name"])
        lines.append(f'  <object id="{oid}">')
        lines.append(f'    <metadata key="name" value="{_xml_attr_escape(name)}"/>')
        lines.append('    <metadata key="extruder" value="1"/>')
        lines.append(f'    <part id="{part_id}" subtype="normal_part">')
        lines.append(f'      <metadata key="name" value="{_xml_attr_escape(name)}"/>')
        lines.append('      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>')
        lines.append('      <metadata key="source_file" value=""/>')
        lines.append('      <metadata key="source_object_id" value="0"/>')
        lines.append('      <metadata key="source_volume_id" value="0"/>')
        lines.append('      <mesh_stat edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/>')
        lines.append("    </part>")
        lines.append("  </object>")

    # One <plate> per plater_id (multiple bodies may share a plate when packing).
    plates: dict[int, list[dict[str, Any]]] = {}
    for body in bodies:
        plates.setdefault(int(body["plate_id"]), []).append(body)
    for plate_id in sorted(plates):
        members = plates[plate_id]
        if len(members) == 1:
            plate_name = _xml_attr_escape(str(members[0].get("plate_name") or members[0]["name"]))
        else:
            plate_name = _xml_attr_escape(f"Plate {plate_id}")
        lines.append("  <plate>")
        lines.append(f'    <metadata key="plater_id" value="{plate_id}"/>')
        lines.append(f'    <metadata key="plater_name" value="{plate_name}"/>')
        lines.append('    <metadata key="locked" value="false"/>')
        for body in members:
            oid = int(body["object_id"])
            identify = int(body.get("identify_id") or oid)
            lines.append("    <model_instance>")
            lines.append(f'      <metadata key="object_id" value="{oid}"/>')
            lines.append('      <metadata key="instance_id" value="0"/>')
            lines.append(f'      <metadata key="identify_id" value="{identify}"/>')
            lines.append("    </model_instance>")
        lines.append("  </plate>")

    lines.append("  <assemble>")
    for body in bodies:
        oid = int(body["object_id"])
        assemble_tf = str(body.get("assemble_transform") or THREEMF_IDENTITY_TRANSFORM)
        lines.append(
            f'   <assemble_item object_id="{oid}" instance_id="0" '
            f'transform="{assemble_tf}" offset="0 0 0" />'
        )
    lines.append("  </assemble>")
    lines.append("</config>")
    lines.append("")
    return "\n".join(lines)


def _xml_attr_escape(value: str) -> str:
    return (
        str(value)
        .replace("&", "&amp;")
        .replace('"', "&quot;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def _export_generic_scene_3mf(
    prepared: list[tuple[str, trimesh.Trimesh]],
    path: Path,
) -> Path:
    """Single-plate generic 3MF (one build, all bodies together)."""
    model = ET.Element(
        f"{{{THREEMF_CORE_NS}}}model",
        {
            "unit": "millimeter",
            "{http://www.w3.org/XML/1998/namespace}lang": "en-US",
        },
    )
    ET.SubElement(model, f"{{{THREEMF_CORE_NS}}}metadata", {"name": "Application"}).text = "Render Studio"
    resources = ET.SubElement(model, f"{{{THREEMF_CORE_NS}}}resources")
    build = ET.SubElement(
        model,
        f"{{{THREEMF_CORE_NS}}}build",
        {f"{{{THREEMF_PRODUCTION_NS}}}UUID": str(uuid.uuid4())},
    )
    object_id = 1
    for name, mesh in prepared:
        _append_3mf_mesh_object(
            resources,
            build,
            object_id=object_id,
            name=name,
            mesh=mesh,
        )
        object_id += 1
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", _3MF_CONTENT_TYPES_XML)
        zf.writestr("_rels/.rels", _3MF_RELS_XML)
        zf.writestr("3D/3dmodel.model", _xml_bytes(model))
    return path


def _assign_bambu_plate_indices(count: int, max_plates: int = THREEMF_BAMBU_MAX_PLATES) -> list[int]:
    """Fallback: one body per plate until max_plates, then round-robin."""
    n = max(int(count), 0)
    if n <= 0:
        return []
    if n <= max_plates:
        return list(range(n))
    return [i % max_plates for i in range(n)]


def _assign_bambu_plates_packed(
    meshes: list[trimesh.Trimesh],
    *,
    bed_w: float = THREEMF_BAMBU_BED_W,
    bed_d: float = THREEMF_BAMBU_BED_D,
    margin: float = THREEMF_BAMBU_EDGE_MARGIN,
    gap: float = 4.0,
    max_plates: int = THREEMF_BAMBU_MAX_PLATES,
) -> tuple[list[int], list[tuple[float, float]]]:
    """Bin-pack bodies onto plates; return (plate_index per body, plate-local XY centers).

    Large parts that nearly fill the bed get their own plate. Smaller parts share
    a plate when they fit so every part is on-bed and the whole kit is printable.
    """
    n = len(meshes)
    if n <= 0:
        return [], []
    if n == 1:
        return [0], [(0.5 * bed_w, 0.5 * bed_d)]

    usable_w = max(bed_w - 2 * margin, 1.0)
    usable_d = max(bed_d - 2 * margin, 1.0)

    def footprint(mesh: trimesh.Trimesh) -> tuple[float, float]:
        extents = np.asarray(mesh.extents, dtype=float)
        return float(max(extents[0], 1.0)), float(max(extents[1], 1.0))

    # Place largest first so small parts fill gaps.
    order = sorted(range(n), key=lambda i: -(footprint(meshes[i])[0] * footprint(meshes[i])[1]))
    plate_of = [0] * n
    seat_xy: list[tuple[float, float]] = [(0.5 * bed_w, 0.5 * bed_d)] * n
    # Per-plate shelf: [cursor_x, cursor_y, row_h]
    shelves: list[list[float]] = []

    def try_place(state: list[float], w: float, d: float) -> tuple[bool, list[float], float, float]:
        cx, cy, row_h = state
        if cx > margin + 1e-6 and cx + w > bed_w - margin:
            place_x = margin
            place_y = cy + row_h + gap
            if place_y + d > bed_d - margin + 1e-6:
                return False, state, 0.0, 0.0
            next_state = [place_x + w + gap, place_y, d]
            return True, next_state, place_x + 0.5 * w, place_y + 0.5 * d
        if cx + w <= bed_w - margin + 1e-6 and cy + d <= bed_d - margin + 1e-6:
            next_state = [cx + w + gap, cy, max(row_h, d)]
            return True, next_state, cx + 0.5 * w, cy + 0.5 * d
        place_x = margin
        place_y = cy + row_h + gap
        if place_x + w <= bed_w - margin + 1e-6 and place_y + d <= bed_d - margin + 1e-6:
            next_state = [place_x + w + gap, place_y, d]
            return True, next_state, place_x + 0.5 * w, place_y + 0.5 * d
        return False, state, 0.0, 0.0

    for idx in order:
        w0, d0 = footprint(meshes[idx])
        needs_own = w0 >= usable_w * 0.85 or d0 >= usable_d * 0.85
        scale = min(1.0, usable_w / w0, usable_d / d0)
        w, d = w0 * scale, d0 * scale
        placed = False
        if not needs_own:
            for pi, state in enumerate(shelves):
                ok, new_state, sx, sy = try_place(state, w, d)
                if ok:
                    shelves[pi] = new_state
                    plate_of[idx] = pi
                    seat_xy[idx] = (sx, sy)
                    placed = True
                    break
        if placed:
            continue
        if len(shelves) >= max_plates:
            # Last-resort: own-ish seat centered on the last plate.
            pi = max(len(shelves) - 1, 0)
            plate_of[idx] = pi
            seat_xy[idx] = (0.5 * bed_w, 0.5 * bed_d)
            continue
        # New plate — part goes at top-left shelf start.
        place_x, place_y = margin, margin
        shelves.append([place_x + w + gap, place_y, d])
        plate_of[idx] = len(shelves) - 1
        seat_xy[idx] = (place_x + 0.5 * w, place_y + 0.5 * d)

    # Shelf packing begins at the margin so it can make deterministic fit
    # decisions, but leaving those raw coordinates in the archive pins sparse
    # plates to the upper-left corner. Translate each completed plate as one
    # group to the bed center; relative spacing and collision decisions remain
    # unchanged.
    centered_xy = list(seat_xy)
    for plate_index in sorted(set(plate_of)):
        members = [index for index, value in enumerate(plate_of) if value == plate_index]
        if not members:
            continue
        lows_x: list[float] = []
        highs_x: list[float] = []
        lows_y: list[float] = []
        highs_y: list[float] = []
        for index in members:
            width, depth = footprint(meshes[index])
            cx, cy = seat_xy[index]
            lows_x.append(cx - 0.5 * width)
            highs_x.append(cx + 0.5 * width)
            lows_y.append(cy - 0.5 * depth)
            highs_y.append(cy + 0.5 * depth)
        shift_x = 0.5 * bed_w - 0.5 * (min(lows_x) + max(highs_x))
        shift_y = 0.5 * bed_d - 0.5 * (min(lows_y) + max(highs_y))
        for index in members:
            cx, cy = seat_xy[index]
            centered_xy[index] = (cx + shift_x, cy + shift_y)

    return plate_of, centered_xy


def _bambu_safe_center(
    mesh: trimesh.Trimesh,
    center_xy: tuple[float, float],
    *,
    bed_w: float = THREEMF_BAMBU_BED_W,
    bed_d: float = THREEMF_BAMBU_BED_D,
    margin: float = THREEMF_BAMBU_EDGE_MARGIN,
) -> tuple[float, float]:
    """Clamp a printable part inside the plate warning margin without scaling it."""
    extents = np.asarray(mesh.extents, dtype=float)
    half_w = 0.5 * float(max(extents[0], 0.0))
    half_d = 0.5 * float(max(extents[1], 0.0))

    def clamp_axis(value: float, half: float, bed: float) -> float:
        low = margin + half
        high = bed - margin - half
        if low > high:
            return 0.5 * bed
        return min(max(float(value), low), high)

    cx = clamp_axis(center_xy[0], half_w, bed_w)
    cy = clamp_axis(center_xy[1], half_d, bed_d)
    ex0, ey0, ex1, ey1 = THREEMF_BAMBU_EXCLUDE_RECT
    gap = THREEMF_BAMBU_EXCLUDE_GAP
    overlaps_x = cx + half_w > ex0 - gap and cx - half_w < ex1 + gap
    overlaps_y = cy + half_d > ey0 - gap and cy - half_d < ey1 + gap
    if overlaps_x and overlaps_y:
        move_right = ex1 + gap + half_w
        move_up = ey1 + gap + half_d
        right_fits = move_right + half_w <= bed_w - margin
        up_fits = move_up + half_d <= bed_d - margin
        dx = move_right - cx if right_fits else math.inf
        dy = move_up - cy if up_fits else math.inf
        if dx <= dy:
            cx = move_right
        elif up_fits:
            cy = move_up
    return cx, cy


def _bambu_should_split_bodies(
    project_path: Path,
    src: Path,
    body_names: list[str],
) -> bool:
    """True when bodies are real separate printables (not GLB tessellation crumbs)."""
    if len(body_names) < 2:
        return False
    if _scene_names_are_single_logical_body(body_names):
        return False
    glb_path = src
    if src.suffix.lower() not in {".glb", ".gltf"}:
        try:
            viewer = viewer_filename_for_model(src.name, project_path)
            candidate = Path(project_path) / viewer
            if candidate.is_file():
                glb_path = candidate
        except Exception:
            pass
    solid_count = _sibling_step_solid_count(project_path, glb_path, src.name)
    if solid_count is not None:
        return solid_count >= 2
    keys = {key for name in body_names if (key := _logical_body_name_key(name))}
    return len(keys) >= 2


def _relabel_bodies_from_step(
    project_path: Path,
    src: Path,
    items: list[tuple[str, trimesh.Trimesh]],
) -> list[tuple[str, trimesh.Trimesh]]:
    """Prefer STEP occurrence names (Bottom Plate, Arm…) for Bambu object labels."""
    if len(items) < 2:
        return items
    try:
        glb_path = src
        if src.suffix.lower() not in {".glb", ".gltf"}:
            viewer = viewer_filename_for_model(src.name, project_path)
            candidate = Path(project_path) / viewer
            if candidate.is_file():
                glb_path = candidate
        occ = _sibling_step_occurrence_names(project_path, glb_path, src.name)
        authored = _sibling_authored_body_names(project_path, glb_path, src.name)
        raw = [name for name, _ in items]
        labels = _display_names_for_scene_bodies(raw, occ, authored)
        out: list[tuple[str, trimesh.Trimesh]] = []
        for idx, (_old, mesh) in enumerate(items):
            label = _safe_object_name(labels[idx] if idx < len(labels) else _old, f"part_{idx + 1}")
            out.append((label, mesh))
        return out
    except Exception as exc:
        logger.debug("body relabel skipped: %s", exc)
        return items


def _pack_offsets_on_plate(
    meshes: list[trimesh.Trimesh],
    *,
    bed_w: float = THREEMF_BAMBU_BED_W,
    bed_d: float = THREEMF_BAMBU_BED_D,
    margin: float = 6.0,
    gap: float = 4.0,
    allow_overflow: bool = True,
) -> list[tuple[float, float]]:
    """Shelf-pack mesh XY extents; returns per-mesh center targets.

    When ``allow_overflow`` is True (default), parts that do not fit on the bed
    continue onto further rows past the bed edge so every body stays visible.
    Bambu's Add Plate / Arrange can then split them — we must not invent empty
    virtual plates ourselves.
    """
    if len(meshes) == 1:
        return [(0.5 * bed_w, 0.5 * bed_d)]
    cursor_x = margin
    cursor_y = margin
    row_h = 0.0
    usable_w = max(bed_w - 2 * margin, 1.0)
    usable_d = max(bed_d - 2 * margin, 1.0)
    centers: list[tuple[float, float]] = []
    for mesh in meshes:
        extents = np.asarray(mesh.extents, dtype=float)
        w = float(max(extents[0], 1.0))
        d = float(max(extents[1], 1.0))
        # Scale down only for packing math if a single part is larger than the bed.
        scale = min(1.0, usable_w / w, usable_d / d)
        w *= scale
        d *= scale
        if cursor_x > margin and cursor_x + w > bed_w - margin:
            cursor_x = margin
            cursor_y += row_h + gap
            row_h = 0.0
        if not allow_overflow and cursor_y + d > bed_d - margin:
            # Legacy: stack near center when forced to stay on-bed.
            centers.append((0.5 * bed_w + (len(centers) % 3 - 1) * 8.0, 0.5 * bed_d))
            continue
        centers.append((cursor_x + 0.5 * w, cursor_y + 0.5 * d))
        cursor_x += w + gap
        row_h = max(row_h, d)
    return centers


def _seat_mesh_at_plate_xy(
    mesh: trimesh.Trimesh,
    center_x: float,
    center_y: float,
) -> trimesh.Trimesh:
    """Seat mesh on Z=0 with its XY center at the given plate-local point."""
    copy = mesh.copy()
    bounds = np.asarray(copy.bounds, dtype=float)
    lo, hi = bounds[0], bounds[1]
    shift = np.array(
        [
            float(center_x) - 0.5 * (lo[0] + hi[0]),
            float(center_y) - 0.5 * (lo[1] + hi[1]),
            -float(lo[2]),
        ],
        dtype=float,
    )
    copy.apply_translation(shift)
    return copy


def _load_slicer_part_placements(
    project_path: Path | None,
    filename: str | None,
    count: int,
) -> list[_SlicerPartPlacement] | None:
    """Load the persisted plate editor state in stable part-N order."""
    if project_path is None or not filename or count <= 0:
        return None
    stem = Path(str(filename)).stem[:80] or "model"
    sidecar = Path(project_path) / "slicer-layout" / f"{stem}.json"
    if not sidecar.is_file():
        return None
    try:
        payload = json.loads(sidecar.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    rows = payload.get("parts") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        return None
    by_id = {
        str(row.get("id")): row
        for row in rows
        if isinstance(row, dict) and row.get("id")
    }
    placements: list[_SlicerPartPlacement] = []
    for index in range(count):
        row = by_id.get(f"part-{index + 1}")
        if not isinstance(row, dict):
            return None
        center = row.get("center_mm")
        rotation = row.get("rotation_deg")
        if not isinstance(center, list) or len(center) < 2:
            return None
        if not isinstance(rotation, list) or len(rotation) < 3:
            return None
        try:
            cx, cy = float(center[0]), float(center[1])
            rx, ry, rz = (float(rotation[i]) for i in range(3))
            plate_index = int(row.get("plate_id") or 1) - 1
        except (TypeError, ValueError, OverflowError):
            return None
        values = (cx, cy, rx, ry, rz)
        if not all(math.isfinite(value) for value in values):
            return None
        if plate_index < 0 or plate_index >= THREEMF_BAMBU_MAX_PLATES:
            return None
        placements.append(
            _SlicerPartPlacement(
                plate_index=plate_index,
                center_xy=(cx, cy),
                rotation_deg=(rx, ry, rz),
            )
        )
    return placements


def _apply_slicer_rotation(
    mesh: trimesh.Trimesh,
    rotation_deg: tuple[float, float, float],
) -> trimesh.Trimesh:
    copy = mesh.copy()
    if not any(abs(value) > 1e-9 for value in rotation_deg):
        return copy
    matrix = trimesh.transformations.euler_matrix(
        *(math.radians(value) for value in rotation_deg),
        axes="sxyz",
    )
    copy.apply_transform(matrix)
    return copy


def _point_in_convex_polygon(point: np.ndarray, polygon: np.ndarray) -> bool:
    if len(polygon) < 3:
        return False
    center = np.mean(polygon, axis=0)
    angles = np.arctan2(polygon[:, 1] - center[1], polygon[:, 0] - center[0])
    ordered = polygon[np.argsort(angles)]
    edges = np.roll(ordered, -1, axis=0) - ordered
    rel = np.asarray(point, dtype=float) - ordered
    crosses = edges[:, 0] * rel[:, 1] - edges[:, 1] * rel[:, 0]
    tolerance = max(float(np.ptp(ordered[:, 0])), float(np.ptp(ordered[:, 1])), 1.0) * 1e-8
    return bool(np.all(crosses >= -tolerance) or np.all(crosses <= tolerance))


def _print_orientation_score(mesh: trimesh.Trimesh) -> tuple[float, float, float]:
    bounds = np.asarray(mesh.bounds, dtype=float)
    min_z = float(bounds[0, 2])
    height = float(bounds[1, 2] - min_z)
    triangles = np.asarray(mesh.triangles, dtype=float)
    normals = np.asarray(mesh.face_normals, dtype=float)
    areas = np.asarray(mesh.area_faces, dtype=float)
    tolerance = max(height, 1.0) * 1e-6
    on_bed = np.max(np.abs(triangles[:, :, 2] - min_z), axis=1) <= tolerance
    contact_area = float(np.sum(areas[on_bed & (normals[:, 2] < -0.95)]))
    face_z = np.mean(triangles[:, :, 2], axis=1)
    unsupported = (normals[:, 2] < -math.cos(math.radians(45.0))) & (face_z > min_z + tolerance)
    support_area = float(np.sum(areas[unsupported] * -normals[unsupported, 2]))
    return support_area * 4.0 - contact_area, support_area, height


BAMBU_AUTO_ORIENT_MAX_PARTS = 128
BAMBU_AUTO_ORIENT_MAX_TOTAL_FACES = 250_000
BAMBU_AUTO_ORIENT_MAX_FACES_PER_PART = 50_000
BAMBU_AUTO_ORIENT_MAX_CANDIDATE_FACETS = 128


def _orient_mesh_for_print(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    """Choose a stable convex-hull face with low support demand and high bed contact."""
    source = mesh.copy()
    candidates: list[trimesh.Trimesh] = [source]
    try:
        hull = source.convex_hull
        center_mass = np.asarray(source.center_mass, dtype=float)
        hull_vertices = np.asarray(hull.vertices, dtype=float)
        facets = list(hull.facets)
        normals = list(hull.facets_normal)
        if len(facets) > BAMBU_AUTO_ORIENT_MAX_CANDIDATE_FACETS:
            areas = np.asarray(hull.facets_area, dtype=float)
            selected = np.argsort(areas)[-BAMBU_AUTO_ORIENT_MAX_CANDIDATE_FACETS:]
            facets = [facets[int(index)] for index in selected]
            normals = [normals[int(index)] for index in selected]
        for facet, normal in zip(facets, normals):
            matrix = trimesh.geometry.align_vectors(
                np.asarray(normal, dtype=float),
                np.array([0.0, 0.0, -1.0]),
            )
            if matrix is None:
                continue
            facet_vertex_ids = np.unique(np.asarray(hull.faces)[np.asarray(facet)].reshape(-1))
            support_points = trimesh.transform_points(hull_vertices[facet_vertex_ids], matrix)[:, :2]
            transformed_center = trimesh.transform_points(center_mass.reshape(1, 3), matrix)[0, :2]
            if not _point_in_convex_polygon(transformed_center, support_points):
                continue
            candidate = source.copy()
            candidate.apply_transform(matrix)
            candidates.append(candidate)
    except Exception as exc:
        logger.debug("print orientation candidates skipped: %s", exc)
    return min(candidates, key=_print_orientation_score)


def _auto_orient_multiplate_meshes(
    meshes: list[trimesh.Trimesh],
) -> list[trimesh.Trimesh]:
    """Auto-orient ordinary kits while keeping very large exports predictable."""
    face_counts = [len(mesh.faces) for mesh in meshes]
    if (
        len(meshes) > BAMBU_AUTO_ORIENT_MAX_PARTS
        or any(count > BAMBU_AUTO_ORIENT_MAX_FACES_PER_PART for count in face_counts)
        or sum(face_counts) > BAMBU_AUTO_ORIENT_MAX_TOTAL_FACES
    ):
        logger.info(
            "3MF auto orientation skipped for %s bodies / %s faces (performance budget)",
            len(meshes),
            sum(face_counts),
        )
        return meshes
    return [_orient_mesh_for_print(mesh) for mesh in meshes]


def _export_bambu_multiplate_3mf(
    prepared: list[tuple[str, trimesh.Trimesh]],
    path: Path,
    *,
    assemble_centers: list[np.ndarray] | None = None,
    placements: list[_SlicerPartPlacement] | None = None,
) -> Path:
    """Bambu Studio project 3MF: separate objects packed onto multiple plates.

    Each CAD body is its own printable. Small parts share a plate when they fit;
    large parts get their own. Every mesh is seated on-bed for its plate so the
    whole kit can be sliced/printed (plates 01, 02, … in Studio).
    """
    n = len(prepared)
    meshes = [mesh for _, mesh in prepared]

    # Assembly centers for Assembly view (original relative layout)
    if assemble_centers is None or len(assemble_centers) != n:
        assemble_centers = []
        for mesh in meshes:
            bounds = np.asarray(mesh.bounds, dtype=float)
            assemble_centers.append(0.5 * (bounds[0] + bounds[1]))
    assemble_origin = np.mean(np.vstack(assemble_centers), axis=0) if assemble_centers else np.zeros(3)

    if placements is not None and len(placements) == n:
        meshes = [
            _apply_slicer_rotation(mesh, placements[index].rotation_deg)
            for index, mesh in enumerate(meshes)
        ]
        prepared = [(prepared[index][0], mesh) for index, mesh in enumerate(meshes)]
        plate_of = [placement.plate_index for placement in placements]
        seat_centers = [placement.center_xy for placement in placements]
    else:
        if n >= 2:
            meshes = _auto_orient_multiplate_meshes(meshes)
            prepared = [(prepared[index][0], mesh) for index, mesh in enumerate(meshes)]
        plate_of, seat_centers = _assign_bambu_plates_packed(meshes)
    if not plate_of:
        plate_of = _assign_bambu_plate_indices(n)
        seat_centers = _pack_offsets_on_plate(meshes, allow_overflow=False)
    plate_count = (max(plate_of) + 1) if plate_of else 1
    if n >= 2:
        logger.info("3MF packed %s bodies onto %s Bambu plate(s)", n, plate_count)

    members_by_plate: dict[int, list[int]] = {}
    for idx, plate_idx in enumerate(plate_of):
        members_by_plate.setdefault(plate_idx, []).append(idx)

    bodies_meta: list[dict[str, Any]] = []
    object_files: list[tuple[str, bytes]] = []
    seated_meshes: list[trimesh.Trimesh] = []

    root_model = ET.Element(
        f"{{{THREEMF_CORE_NS}}}model",
        {
            "unit": "millimeter",
            "{http://www.w3.org/XML/1998/namespace}lang": "en-US",
            "requiredextensions": "p",
        },
    )
    # Must start with "BambuStudio-" or Studio treats this as geometry-only (no multi-plate UI).
    ET.SubElement(root_model, f"{{{THREEMF_CORE_NS}}}metadata", {"name": "Application"}).text = (
        THREEMF_BAMBU_APPLICATION
    )
    ET.SubElement(root_model, f"{{{THREEMF_CORE_NS}}}metadata", {"name": "BambuStudio:3mfVersion"}).text = "1"
    resources = ET.SubElement(root_model, f"{{{THREEMF_CORE_NS}}}resources")
    build = ET.SubElement(
        root_model,
        f"{{{THREEMF_CORE_NS}}}build",
        {f"{{{THREEMF_PRODUCTION_NS}}}UUID": THREEMF_BAMBU_BUILD_UUID},
    )

    rel_lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<Relationships xmlns="{THREEMF_REL_NS}">',
    ]

    for idx, (name, raw_mesh) in enumerate(prepared):
        plate_idx = plate_of[idx]
        # Bambu pattern: mesh in Objects/object_K.model; wrapper id = 2*K.
        # Mesh object ids MUST be unique across files — Studio conflates identical
        # id="1" meshes (every plate showed the same Bottom Plate geometry).
        file_index = idx + 1
        mesh_object_id = file_index * 2 - 1
        wrapper_id = file_index * 2
        mesh_path = f"/3D/Objects/object_{file_index}.model"

        requested_center = seat_centers[idx] if idx < len(seat_centers) else (
            0.5 * THREEMF_BAMBU_BED_W,
            0.5 * THREEMF_BAMBU_BED_D,
        )
        cx, cy = _bambu_safe_center(raw_mesh, requested_center)
        seated = _seat_mesh_at_plate_xy(raw_mesh, cx, cy)
        seated_meshes.append(seated)
        object_files.append(
            (
                f"3D/Objects/object_{file_index}.model",
                _build_object_model_xml(
                    seated,
                    mesh_object_id=mesh_object_id,
                    file_index=file_index,
                ),
            )
        )

        wrapper = ET.SubElement(
            resources,
            f"{{{THREEMF_CORE_NS}}}object",
            {
                "id": str(wrapper_id),
                "type": "model",
                f"{{{THREEMF_PRODUCTION_NS}}}UUID": _bambu_hex_uuid(
                    file_index, THREEMF_BAMBU_OBJECT_UUID_SUFFIX
                ),
            },
        )
        components = ET.SubElement(wrapper, f"{{{THREEMF_CORE_NS}}}components")
        ET.SubElement(
            components,
            f"{{{THREEMF_CORE_NS}}}component",
            {
                f"{{{THREEMF_PRODUCTION_NS}}}path": mesh_path,
                "objectid": str(mesh_object_id),
                f"{{{THREEMF_PRODUCTION_NS}}}UUID": _bambu_hex_uuid(
                    (file_index << 16) | 1, THREEMF_BAMBU_COMPONENT_UUID_SUFFIX
                ),
                "transform": THREEMF_IDENTITY_TRANSFORM,
            },
        )

        ox, oy = _bambu_plate_origin(plate_idx, plate_count)
        ET.SubElement(
            build,
            f"{{{THREEMF_CORE_NS}}}item",
            {
                "objectid": str(wrapper_id),
                f"{{{THREEMF_PRODUCTION_NS}}}UUID": _bambu_hex_uuid(
                    wrapper_id, THREEMF_BAMBU_BUILD_ITEM_UUID_SUFFIX
                ),
                "transform": _translation_transform(ox, oy, 0.0),
                "printable": "1",
            },
        )
        rel_lines.append(
            f' <Relationship Target="/3D/Objects/object_{file_index}.model" '
            f'Id="rel-{file_index}" Type="{THREEMF_MODEL_REL_TYPE}"/>'
        )

        center = np.asarray(assemble_centers[idx], dtype=float)
        assemble_tf = np.eye(4)
        assemble_tf[0:3, 3] = center - assemble_origin
        solo = len(members_by_plate.get(plate_idx, [])) == 1
        bodies_meta.append(
            {
                "object_id": wrapper_id,
                "part_id": mesh_object_id,
                "name": name,
                "plate_id": plate_idx + 1,
                "plate_name": name if solo else f"Plate {plate_idx + 1}",
                "identify_id": wrapper_id,
                "assemble_transform": _transform_12_from_matrix(assemble_tf),
            }
        )

    rel_lines.append("</Relationships>")
    rel_lines.append("")

    settings_xml = _build_bambu_model_settings(bodies_meta)
    base_project_settings = _bambu_project_settings_bytes()
    try:
        support_threshold = float(
            json.loads(base_project_settings.decode("utf-8")).get(
                "support_threshold_angle", 30.0
            )
        )
    except (UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError):
        support_threshold = 30.0
    from backend.services.print_support_analysis import analyze_mesh_support

    support_face_budget = 250_000
    per_mesh_face_budget = max(3, support_face_budget // max(1, len(seated_meshes)))
    support_results = [
        analyze_mesh_support(
            mesh,
            support_threshold_angle_deg=support_threshold,
            bed_z_mm=0.0,
            max_faces=per_mesh_face_budget,
        )
        for mesh in seated_meshes
    ]
    support_required = any(result.needs_support for result in support_results)
    logger.info(
        "3MF support preflight: required=%s, bodies=%s, sampled_faces=%s/%s",
        support_required,
        len(support_results),
        sum(result.sampled_face_count for result in support_results),
        sum(result.face_count for result in support_results),
    )
    project_settings = _bambu_project_settings_bytes(enable_support=support_required)

    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", _3MF_BAMBU_CONTENT_TYPES_XML)
        zf.writestr("_rels/.rels", _3MF_RELS_XML)
        zf.writestr("3D/3dmodel.model", _xml_bytes(root_model))
        zf.writestr("3D/_rels/3dmodel.model.rels", "\n".join(rel_lines))
        for arcname, payload in object_files:
            zf.writestr(arcname, payload)
        zf.writestr("Metadata/model_settings.config", settings_xml)
        # Required for Studio to call load_from_3mf_structure() → real plates 01/02/…
        zf.writestr("Metadata/project_settings.config", project_settings)
    return path


def export_scene_3mf(
    scene: trimesh.Scene,
    path: Path,
    *,
    visible_body_indices: list[int] | None = None,
    source_path: Path | None = None,
    multiplate: bool = False,
    project_path: Path | None = None,
    layout_filename: str | None = None,
) -> Path:
    """Write a mesh 3MF (mm units) compatible with Bambu Studio and other slicers.

    Always writes a Bambu project 3MF (``Metadata/model_settings.config`` + plates).

    - Single CAD solid / tessellation fragments → one merged printable on one plate.
    - Real multi-body assemblies → separate objects packed onto as many plates as
      needed so every part sits on-bed and the whole kit can be sliced/printed.

    ``multiplate=True`` forces the split path (``__part_`` kits or detected
    multi-solid assemblies).
    """
    scene_items = _meshes_from_scene(scene, source_path=source_path)
    if visible_body_indices is not None:
        allowed = {int(i) for i in visible_body_indices if int(i) >= 0}
        scene_items = [
            item for idx, item in enumerate(scene_items) if idx in allowed
        ]
    if not scene_items:
        raise ValueError("no geometry to export to 3MF")

    path.parent.mkdir(parents=True, exist_ok=True)
    prepared: list[tuple[str, trimesh.Trimesh]] = []
    assemble_centers: list[np.ndarray] = []
    # Files in a Render Studio project have already crossed the import boundary
    # and use workspace millimeters. In particular, trimesh labels all glTF as
    # meters even when our authored GLB coordinates are deliberately millimeters.
    workspace_scale = 1.0 if source_path is not None else None
    for name, raw_mesh in scene_items:
        mesh = _prepare_mesh_for_3mf(raw_mesh, unit_scale_to_mm=workspace_scale)
        if mesh is None:
            continue
        bounds = np.asarray(mesh.bounds, dtype=float)
        assemble_centers.append(0.5 * (bounds[0] + bounds[1]))
        prepared.append((name, mesh))

    if not prepared:
        raise ValueError("no exportable geometry for 3MF")

    use_multiplate = bool(multiplate) and len(prepared) >= 2
    if not use_multiplate and project_path is not None and source_path is not None and len(prepared) >= 2:
        use_multiplate = _bambu_should_split_bodies(
            Path(project_path),
            Path(source_path),
            [name for name, _ in prepared],
        )

    if use_multiplate and project_path is not None and source_path is not None:
        prepared = _relabel_bodies_from_step(Path(project_path), Path(source_path), prepared)

    if not use_multiplate and len(prepared) > 1:
        # Collapse tessellation fragments of one solid into one seated printable.
        try:
            combined = trimesh.util.concatenate([m for _, m in prepared])
        except Exception:
            combined = prepared[0][1]
        merged = _prepare_mesh_for_3mf(combined, unit_scale_to_mm=1.0)
        if merged is None:
            raise ValueError("no exportable geometry for 3MF")
        label = _safe_object_name(
            Path(source_path).stem if source_path else prepared[0][0],
            "model",
        )
        prepared = [(label, merged)]
        bounds = np.asarray(merged.bounds, dtype=float)
        assemble_centers = [0.5 * (bounds[0] + bounds[1])]

    placements = None
    if use_multiplate and visible_body_indices is None:
        placements = _load_slicer_part_placements(
            project_path,
            layout_filename or (source_path.name if source_path is not None else None),
            len(prepared),
        )
    return _export_bambu_multiplate_3mf(
        prepared,
        path,
        assemble_centers=assemble_centers,
        placements=placements,
    )


def scene_for_3mf_export(
    project_path: Path,
    src: Path,
    *,
    match_viewer_body_indices: bool = False,
) -> tuple[trimesh.Scene, Path | None, bool]:
    """Load a scene for Bambu/3MF export.

    Returns ``(scene, source_path, multiplate)``. ``multiplate`` is True for
    explicit ``__part_*.glb`` kits and for real multi-solid assemblies.
    """
    project_path = Path(project_path)
    src = Path(src)
    stem = src.stem

    def _part_sidecars_for(stem_name: str) -> list[Path]:
        def _part_key(p: Path) -> tuple[int, str]:
            m = re.search(r"__part_(\d+)_", p.stem, flags=re.I)
            return (int(m.group(1)) if m else 10**9, p.name.lower())

        found: list[Path] = []
        seen: set[str] = set()
        folders = [src.parent, project_path]
        roots = [stem_name]
        stripped = re.sub(r"_edited(?:_\d+)?$", "", stem_name, flags=re.I)
        if stripped != stem_name:
            roots.append(stripped)
        for folder in folders:
            if not folder.is_dir():
                continue
            for root in roots:
                for part in sorted(folder.glob(f"{root}__part_*.glb"), key=_part_key):
                    key = str(part.resolve()) if part.exists() else part.as_posix()
                    if key in seen:
                        continue
                    seen.add(key)
                    found.append(part)
            if found:
                return found
        return found

    def _scene_from_parts(part_files: list[Path]) -> trimesh.Scene | None:
        scene = trimesh.Scene()
        for part in part_files:
            try:
                geom = load_mesh(part)
                label = re.sub(r"^.*?__part_\d+_", "", part.stem, flags=re.I) or part.stem
                label = _safe_object_name(label.replace("_", " "), part.stem)
                scene.add_geometry(geom, geom_name=label, node_name=label)
            except Exception as exc:
                logger.debug("skip part %s: %s", part.name, exc)
        return scene if len(scene.geometry) > 0 else None

    def _load_viewer_scene() -> tuple[trimesh.Scene, Path] | None:
        try:
            from backend.services.engine_layout import project_rel, resolve_in_layout

            hint = project_rel(project_path, src) if src.is_file() else src.name
            viewer_name = viewer_filename_for_model(hint, project_path)
            viewer_path = resolve_in_layout(project_path, viewer_name)
            if viewer_path is None:
                viewer_path = project_path / viewer_name
            if not viewer_path.is_file():
                return None
            if viewer_path.suffix.lower() not in {".glb", ".gltf", ".obj", ".stl", ".ply", ".off", ".3mf"}:
                return None
            scene = load_scene(viewer_path)
            bodies = _meshes_from_scene(scene, source_path=viewer_path)
            if bodies:
                return scene, viewer_path
        except Exception as exc:
            logger.debug("viewer scene for 3MF failed (%s): %s", src.name, exc)
        return None

    def _multiplate_for(scene: trimesh.Scene, scene_src: Path | None) -> bool:
        bodies = _meshes_from_scene(scene, source_path=scene_src)
        names = [name for name, _ in bodies]
        return _bambu_should_split_bodies(project_path, scene_src or src, names)

    part_files = _part_sidecars_for(stem)

    # Eye-filtered export: indices come from the viewer GLB body tree.
    if match_viewer_body_indices:
        loaded = _load_viewer_scene()
        if loaded is not None:
            scene, viewer_path = loaded
            return scene, viewer_path, _multiplate_for(scene, viewer_path)
        if src.suffix.lower() in MESH_VIEW_SUFFIXES | {".glb", ".gltf"}:
            scene = load_scene(src)
            return scene, src, _multiplate_for(scene, src)

    # Explicit __part_ sidecars → Maker World multi-plate kit.
    if len(part_files) >= 2:
        built = _scene_from_parts(part_files)
        if built is not None:
            return built, None, True

    loaded = _load_viewer_scene()
    if loaded is not None:
        scene, viewer_path = loaded
        bodies = _meshes_from_scene(scene, source_path=viewer_path)
        if len(bodies) >= 1:
            return scene, viewer_path, _multiplate_for(scene, viewer_path)

    if part_files:
        built = _scene_from_parts(part_files)
        if built is not None:
            return built, None, len(part_files) >= 2

    if src.suffix.lower() in MESH_VIEW_SUFFIXES | {".glb", ".gltf"}:
        scene = load_scene(src)
        return scene, src, _multiplate_for(scene, src)

    try:
        scene = load_scene(src)
        if _meshes_from_scene(scene, source_path=src):
            return scene, src, _multiplate_for(scene, src)
    except Exception:
        pass

    mesh = load_mesh(src)
    scene = trimesh.Scene()
    scene.add_geometry(mesh, geom_name=src.stem, node_name=src.stem)
    return scene, src, False


def _mesh_geometry_source(project_path: Path, filename: str) -> Path | None:
    """Resolve printable mesh geometry (GLB/STL/…) for a project file.

    Procedural Mesh factories (``.mesh.mjs``) are source code — use the sibling
    viewport GLB instead.
    """
    from backend.services.engine_layout import sibling_with_suffix

    src, _dirs = _model_source_and_export_dirs(project_path, filename)
    if src is None or not src.is_file():
        return derived_export_source(project_path, filename)
    lower = src.name.lower()
    if lower.endswith(".mesh.mjs") or lower.endswith(".mesh.js") or src.suffix.lower() in {".mjs", ".js", ".ts", ".py"}:
        glb = sibling_with_suffix(project_path, filename, (".glb", ".gltf", ".stl", ".obj", ".ply", ".off"))
        if glb is not None and glb.is_file():
            return glb
        viewer = resolve_viewport_filename(project_path, filename)
        if viewer:
            hit = resolve_project_file(project_path, viewer)
            if hit is not None and hit.is_file() and hit.suffix.lower() in MESH_VIEW_SUFFIXES | {".glb", ".gltf"}:
                return hit
        return None
    if src.suffix.lower() in SUPPORTED_IMPORT:
        return src
    return None


def convert_mesh_to_3mf(
    project_path: Path,
    filename: str,
    *,
    dest: Path | None = None,
    visible_body_indices: list[int] | None = None,
) -> Path:
    """Convert a mesh/GLB (including nested ``mesh/`` procedural models) to a printable 3MF.

    Prefers the Bambu project 3MF used by Export → Bambu Studio. If that writer
    fails on a dense procedural mesh, fall back to a generic single-plate 3MF.
    """
    project_path = Path(project_path)
    src = _mesh_geometry_source(project_path, filename)
    if src is None:
        raise ValueError("No mesh file to convert to 3MF")
    dest = Path(dest) if dest is not None else src.with_suffix(".3mf")
    if dest.suffix.lower() != ".3mf":
        dest = dest.with_suffix(".3mf")
    dest.parent.mkdir(parents=True, exist_ok=True)

    last_err: Exception | None = None
    try:
        scene, scene_src, multiplate = scene_for_3mf_export(
            project_path,
            src,
            match_viewer_body_indices=visible_body_indices is not None,
        )
        return export_scene_3mf(
            scene,
            dest,
            visible_body_indices=visible_body_indices,
            source_path=scene_src,
            multiplate=multiplate,
            project_path=project_path,
            layout_filename=filename,
        )
    except Exception as exc:
        last_err = exc
        logger.warning("Bambu 3MF export failed for %s: %s — trying generic 3MF", src.name, exc)

    try:
        try:
            scene = load_scene(src)
            items = _meshes_from_scene(scene, source_path=src)
        except Exception:
            items = []
        if visible_body_indices is not None:
            allowed = {int(i) for i in visible_body_indices if int(i) >= 0}
            items = [item for idx, item in enumerate(items) if idx in allowed]
        prepared: list[tuple[str, trimesh.Trimesh]] = []
        for name, raw in items:
            mesh = _prepare_mesh_for_3mf(raw, unit_scale_to_mm=1.0)
            if mesh is not None:
                prepared.append((name, mesh))
        if not prepared:
            ready = _prepare_mesh_for_3mf(load_mesh(src), unit_scale_to_mm=1.0)
            if ready is None:
                raise ValueError("no exportable geometry for 3MF")
            prepared = [(src.stem.replace("_", " "), ready)]
        prepared = _seat_meshes_on_build_plate(prepared)
        return _export_generic_scene_3mf(prepared, dest)
    except Exception as exc:
        detail = last_err or exc
        raise ValueError(f"Could not convert mesh to 3MF: {detail}") from exc


def _bake_face_colors_to_vertices(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    """Assign vertex colors from face_colors without scipy (needed for GLB export)."""
    fc = _snapshot_face_colors(mesh)
    if fc is None or len(fc) == 0:
        return mesh
    m = mesh_copy(mesh)
    n = len(m.vertices)
    if n < 1 or len(m.faces) == 0:
        return mesh
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


def _explode_keep_face_colors(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    """Give each triangle unique vertices so GLB COLOR_0 does not bleed across faces."""
    n = _mesh_len(mesh, "faces")
    if n < 1 or _mesh_len(mesh, "vertices") < 1:
        return mesh
    fc = _snapshot_face_colors(mesh)
    try:
        verts = np.asarray(mesh.vertices)[np.asarray(mesh.faces).reshape(-1)]
        faces = np.arange(len(verts), dtype=np.int64).reshape((-1, 3))
        out = trimesh.Trimesh(vertices=verts, faces=faces, process=False)
    except Exception:
        return mesh
    if fc is not None and len(fc) == n:
        out.visual.face_colors = np.asarray(fc, dtype=np.uint8)
    return out


def _semantic_color_for_name(name: str | None) -> np.ndarray | None:
    """Map part / prompt words to realistic material colours when possible."""
    text = re.sub(r"[_\-./]+", " ", str(name or "").lower())
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return None
    # Word-boundary match so "rack" does not hit inside "bracket".
    for keywords, rgba in _SEMANTIC_PART_COLOR_RULES:
        for word in keywords:
            if re.search(rf"(?<![\w]){re.escape(word)}(?![\w])", text):
                return np.array(rgba, dtype=np.uint8)
    return None

def _palette_color_for_name(name: str | None) -> np.ndarray:
    semantic = _semantic_color_for_name(name)
    if semantic is not None:
        return semantic.copy()
    return np.array([192, 198, 204, 255], dtype=np.uint8)


def _ensure_default_appearance(mesh: trimesh.Trimesh, *, seed: str | None = None) -> trimesh.Trimesh:
    """Give otherwise grey/uncoloured generated meshes a stable material-like colour."""
    colors = _snapshot_face_colors(mesh)
    if colors is not None and not _colors_are_default_grey(colors):
        return mesh
    m = mesh_copy(mesh)
    if len(m.faces):
        paint = _semantic_color_for_name(seed)
        if paint is None:
            paint = SHOP_APPEARANCE_PALETTE[0].copy()
        m.visual.face_colors = np.tile(paint, (len(m.faces), 1))
    return m


def _prompt_hex_colors(prompt: str) -> list[np.ndarray]:
    """Hexes from an Improve `colors:` clause (aluminum #c0c6cc, …)."""
    found: list[np.ndarray] = []
    for match in re.findall(r"#([0-9a-fA-F]{6})\b", prompt or ""):
        found.append(np.array(_hex_to_rgba_u8(f"#{match}"), dtype=np.uint8))
    return found


def _prompt_appearance_palette(prompt: str, seed: str | None = None) -> list[np.ndarray]:
    hexes = _prompt_hex_colors(prompt)
    if hexes:
        return hexes[:8]
    p = (prompt or "").lower()
    semantic = _semantic_color_for_name(prompt)
    if semantic is None:
        semantic = _semantic_color_for_name(seed)
    if any(re.search(rf"(?<![\w]){re.escape(w)}(?![\w])", p) for w in (
        "chess", "pawn", "rook", "knight", "bishop", "queen", "king", "staunton", "checker", "draught",
    )):
        # Solid chess-set plastic — never height-band rainbows.
        if any(re.search(rf"(?<![\w]){re.escape(w)}(?![\w])", p) for w in ("black", "dark", "ebony", "noir")):
            return [np.array([42, 42, 46, 255], dtype=np.uint8)]
        if any(re.search(rf"(?<![\w]){re.escape(w)}(?![\w])", p) for w in ("white", "light", "ivory", "cream")):
            return [np.array([232, 224, 212, 255], dtype=np.uint8)]
        return [np.array([228, 217, 200, 255], dtype=np.uint8)]
    if any(word in p for word in ("coke", "cola", "soda", "pepsi", "sprite", "fanta", "pet bottle", "plastic bottle")):
        return [
            np.array([212, 232, 240, 235], dtype=np.uint8),  # clear PET body
            np.array([196, 30, 58, 255], dtype=np.uint8),    # red cap/label
            np.array([255, 255, 255, 220], dtype=np.uint8),  # label band
            np.array([28, 28, 32, 255], dtype=np.uint8),     # dark base ring
        ]
    if any(word in p for word in ("coffee", "mug", "cup", "carafe", "kettle")):
        return [
            np.array([232, 230, 224, 255], dtype=np.uint8),  # ceramic
            np.array([30, 33, 36, 255], dtype=np.uint8),     # handle / accent
            np.array([176, 212, 232, 200], dtype=np.uint8),  # glass optional
            np.array([158, 163, 168, 255], dtype=np.uint8),  # metal base
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
            np.array([46, 148, 78, 255], dtype=np.uint8),
            np.array([126, 144, 168, 255], dtype=np.uint8),
            np.array([214, 222, 232, 255], dtype=np.uint8),
            np.array([218, 70, 54, 255], dtype=np.uint8),
            np.array([54, 132, 218, 255], dtype=np.uint8),
        ]
    if any(re.search(rf"(?<![\w]){re.escape(w)}(?![\w])", p) for w in ("wood", "table", "chair", "furniture", "timber")) \
        or "frame house" in p:
        return [
            np.array([196, 154, 98, 255], dtype=np.uint8),
            np.array([168, 120, 72, 255], dtype=np.uint8),
            np.array([232, 214, 168, 255], dtype=np.uint8),
            np.array([148, 178, 120, 255], dtype=np.uint8),
        ]
    if any(word in p for word in ("metal", "steel", "aluminium", "aluminum", "bracket", "chassis", "machine")):
        return [SHOP_APPEARANCE_PALETTE[i].copy() for i in (0, 1, 7, 3)]
    if any(word in p for word in ("robot", "mechanical", "clamp", "mount", "arm", "gear", "actuator")):
        return [SHOP_APPEARANCE_PALETTE[i].copy() for i in (0, 2, 1, 3)]
    if any(word in p for word in ("dxf", "drawing", "blueprint", "laser", "cut", "flat pattern")):
        return [SHOP_APPEARANCE_PALETTE[i].copy() for i in (0, 1, 7)]
    if semantic is not None:
        base = semantic
    else:
        base = _palette_color_for_name(seed)
    accent = np.array(
        [max(0, int(base[0]) - 42), max(0, int(base[1]) - 42), max(0, int(base[2]) - 42), 255],
        dtype=np.uint8,
    )
    highlight = np.array(
        [min(255, int(base[0]) + 48), min(255, int(base[1]) + 48), min(255, int(base[2]) + 48), 255],
        dtype=np.uint8,
    )
    return [base]

def apply_prompt_appearance(mesh: trimesh.Trimesh, prompt: str, *, seed: str | None = None) -> trimesh.Trimesh:
    """Best-effort multi-color fallback for uncoloured generated preview meshes."""
    colors = _snapshot_face_colors(mesh)
    if colors is not None and not _colors_are_default_grey(colors):
        return mesh
    m = mesh_copy(mesh)
    if not len(m.faces):
        return m
    palette = _prompt_appearance_palette(prompt, seed=seed)
    # Single-swatch contexts (chess, semantic solid) — no height/normal banding.
    solid_only = len(palette) == 1 or bool(_semantic_color_for_name(prompt) or _semantic_color_for_name(seed))
    face_colors = np.tile(palette[0], (len(m.faces), 1))
    try:
        if solid_only:
            m.visual.face_colors = face_colors
            return m
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
        if path.suffix.lower() in {".glb", ".gltf"} and colorize_assembly_glb_parts(
            path, force=True, prompt=prompt
        ):
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


# Jake CAD Viewer workbench fills (sRGB 0–1 for glTF baseColorFactor).
JAKE_ASSEMBLY_PART_PALETTE: list[tuple[float, float, float, float]] = [
    (float(row[0]) / 255.0, float(row[1]) / 255.0, float(row[2]) / 255.0, 1.0)
    for row in DEFAULT_APPEARANCE_PALETTE
]


def _is_occ_face_dump_scene(scene: Any) -> bool:
    """True when a GLB is an OCC/STEP face dump (one node per BRep face).

    Named multi-solid assemblies (VibeCAD / Jake, tens of bodies) must still get
    workbench fills. A hard ``>= 48`` cutoff painted those assemblies as one
    hashed colour — often salmon fill 1 / magenta fill 9.
    """
    geoms = list(getattr(scene, "geometry", {}).values()) if scene is not None else []
    n = len(geoms)
    if n < 48:
        return False
    if n >= 150:
        return True
    face_counts: list[int] = []
    for geom in geoms:
        try:
            faces = getattr(geom, "faces", None)
            face_counts.append(int(len(faces)) if faces is not None else 0)
        except Exception:
            face_counts.append(0)
    if not face_counts:
        return True
    tiny = sum(1 for count in face_counts if count <= 2)
    avg = float(sum(face_counts)) / float(len(face_counts))
    # Cubes are 12 faces; real OCC face dumps are 1–2 triangles or n>=150.
    return tiny / n >= 0.45 or (n >= 80 and avg <= 8.0)


def _rgba_is_neutral_grey(rgba: Sequence[float] | None, *, tol: float = 0.045) -> bool:
    if not rgba or len(rgba) < 3:
        return True
    r, g, b = float(rgba[0]), float(rgba[1]), float(rgba[2])
    chroma = max(r, g, b) - min(r, g, b)
    avg = (r + g + b) / 3.0
    # glTF default material / OCC uncolored STEP tessellation.
    if chroma < 0.06 and avg > 0.88:
        return True
    # cadpy DEFAULT_MATERIAL ≈ (0.47, 0.55, 0.62) or flat 184/255 greys
    if chroma < tol and 0.35 <= avg <= 0.85:
        return True
    # Explicit cadpy default-ish steel blue-grey
    if abs(r - 0.468) < 0.08 and abs(g - 0.552) < 0.08 and abs(b - 0.617) < 0.08:
        return True
    return False


def _rgba_is_pastel_workbench(rgba: Sequence[float] | None, *, tol: float = 0.04) -> bool:
    """True for CAD Viewer salmon/mint/lilac fills we no longer want on shop parts."""
    if not rgba or len(rgba) < 3:
        return False
    r, g, b = float(rgba[0]), float(rgba[1]), float(rgba[2])
    for hex_color in WORKBENCH_FILL_HEX[1:]:
        pr, pg, pb, _pa = [c / 255.0 for c in _hex_to_rgba_u8(hex_color)]
        if abs(r - pr) < tol and abs(g - pg) < tol and abs(b - pb) < tol:
            return True
    return False


def colorize_assembly_glb_parts(path: Path, *, force: bool = False, prompt: str = "") -> bool:
    """Assign realistic shop colours to hierarchical GLB nodes.

    Generated assemblies often export every node as cadpy DEFAULT_MATERIAL grey;
    this restores multi-part colouring without flattening the scene. ``force``
    replaces grey and pastel workbench fills; authored shop/material colours stay.
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
    # OCC face dumps (one node per BRep face) must NOT get Jake rainbow colours.
    if _is_occ_face_dump_scene(scene):
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
    if not force and len(meaningful) >= 2:
        return False  # already Jake/Onshape-coloured

    try:
        from trimesh.visual.material import PBRMaterial, SimpleMaterial
    except Exception:
        PBRMaterial = None  # type: ignore
        SimpleMaterial = None  # type: ignore

    prompt_hexes = _prompt_hex_colors(prompt)
    for idx, (name, geom) in enumerate(scene.geometry.items()):
        visual = getattr(geom, "visual", None)
        mat = getattr(visual, "material", None)
        existing = geom_rgba(geom)
        if ((getattr(mat, "metallicFactor", None) or 0) > 0
            or getattr(mat, "baseColorTexture", None) is not None
            or getattr(mat, "image", None) is not None
            or (existing and (existing[3] < 0.95 or (not _rgba_is_neutral_grey(existing) and not _rgba_is_pastel_workbench(existing))))):
            continue
        # Infer one consistent finish per named part; no index-based palettes.
        semantic = None
        try:
            semantic = _semantic_color_for_name(str(name or ""))
        except Exception:
            semantic = None
        if semantic is not None:
            rgba_u8 = np.asarray(semantic, dtype=np.uint8)
            rgba = tuple(float(c) / 255.0 for c in rgba_u8[:4])
        elif len(prompt_hexes) == 1:
            rgba_u8 = prompt_hexes[0]
            rgba = tuple(float(c) / 255.0 for c in rgba_u8[:4])
        else:
            existing = geom_rgba(geom)
            if (
                existing
                and not _rgba_is_neutral_grey(existing)
                and not _rgba_is_pastel_workbench(existing)
            ):
                continue
            rgba = (192 / 255, 198 / 255, 204 / 255, 1.0)
            rgba_u8 = np.array([int(round(c * 255)) for c in rgba], dtype=np.uint8)
        visual = getattr(geom, "visual", None)
        if visual is None:
            continue
        mat = getattr(visual, "material", None)
        if PBRMaterial is not None and (mat is None or mat.__class__.__name__ in {"PBRMaterial", "SimpleMaterial"}):
            try:
                if isinstance(mat, PBRMaterial):
                    mat.baseColorFactor = rgba_u8
                else:
                    visual.material = PBRMaterial(baseColorFactor=np.array(rgba, dtype=np.float64))
            except Exception:
                if SimpleMaterial is not None:
                    visual.material = SimpleMaterial(diffuse=rgba_u8)
        elif hasattr(visual, "face_colors") and getattr(geom, "faces", None) is not None and len(geom.faces):
            visual.face_colors = np.tile(rgba_u8, (len(geom.faces), 1))
        else:
            try:
                if isinstance(mat, PBRMaterial):
                    mat.baseColorFactor = rgba_u8
                else:
                    visual.material = PBRMaterial(baseColorFactor=np.array(rgba, dtype=np.float64)) if PBRMaterial else mat
            except Exception:
                continue

    try:
        scene.export(path, file_type="glb")
        return True
    except Exception as exc:
        logger.warning("Could not save colourized GLB (%s): %s", path.name, exc)
        return False


def _crease_split_cad_mesh(mesh: trimesh.Trimesh, angle_deg: float = 35.0) -> trimesh.Trimesh:
    """Weld coplanar faces but keep sharp CAD edges so rims don't look melted.

    STL tessellation is unique-verts-per-face. Blind ``merge_vertices()`` then
    smooth shading averages 90° walls into a squishy look. Re-weld only when
    vertex normals agree (within ~angle_deg).
    """
    m = mesh_copy(mesh)
    if m is None or m.is_empty or len(m.faces) < 1:
        return m
    try:
        verts = np.asarray(m.vertices)[np.asarray(m.faces).reshape(-1)]
        faces = np.arange(len(verts), dtype=np.int64).reshape((-1, 3))
        exploded = trimesh.Trimesh(vertices=verts, faces=faces, process=False)
        exploded.fix_normals()
        _ = exploded.vertex_normals
        exploded.merge_vertices(merge_norm=True, digits_vertex=5, digits_norm=2)
        exploded.fix_normals()
        _ = exploded.vertex_normals
        return exploded
    except Exception:
        try:
            m.fix_normals()
            _ = m.vertex_normals
        except Exception:
            pass
        return m


def _mesh_with_cad_pbr(
    mesh: trimesh.Trimesh,
    rgba_u8: np.ndarray | None = None,
    *,
    name: str = "",
) -> trimesh.Trimesh:
    """Smooth-shaded PBR mesh with no COLOR_0 / face colors (Jake-style CAD look)."""
    m = mesh_copy(mesh)
    has_normals = False
    try:
        vn = np.asarray(getattr(m, "vertex_normals", None))
        has_normals = (
            vn is not None
            and vn.ndim == 2
            and vn.shape[0] == len(m.vertices)
            and bool(np.isfinite(vn).all())
        )
    except Exception:
        has_normals = False
    # Per-face OCC tessellation already has sharp edges. Don't weld them away.
    if not has_normals:
        m = _crease_split_cad_mesh(m)
    paint = rgba_u8
    if paint is None:
        snap = _snapshot_face_colors(m)
        if snap is not None and len(snap) and not _colors_are_default_grey(snap):
            paint = np.asarray(snap[0], dtype=np.uint8)
        else:
            paint = _semantic_color_for_name(name) or _palette_color_for_name(name)
    factor = np.asarray(paint, dtype=float).reshape(-1)
    if factor.size < 3:
        factor = np.array(
            [float(SHOP_APPEARANCE_PALETTE[0][0]) / 255.0,
             float(SHOP_APPEARANCE_PALETTE[0][1]) / 255.0,
             float(SHOP_APPEARANCE_PALETTE[0][2]) / 255.0,
             1.0],
            dtype=float,
        )
    else:
        if factor.max() > 1.5:
            factor = factor / 255.0
        if factor.size == 3:
            factor = np.append(factor, 1.0)
        factor = factor[:4].astype(np.float64)
    try:
        from trimesh.visual.material import PBRMaterial

        visual_cls = getattr(trimesh.visual, "TextureVisuals", None)
        if visual_cls is None:
            from trimesh.visual.texture import TextureVisuals as visual_cls  # type: ignore
        m.visual = visual_cls(
            material=PBRMaterial(
                name=(name or "cad")[:64],
                baseColorFactor=factor,
                metallicFactor=0.18,
                roughnessFactor=0.42,
            )
        )
    except Exception:
        try:
            if hasattr(m.visual, "vertex_colors"):
                m.visual.vertex_colors = None
            if hasattr(m.visual, "face_colors"):
                m.visual.face_colors = None
        except Exception:
            pass
    return m


def polish_generated_cad_glb(
    path: Path,
    prompt: str = "",
    *,
    seed: str | None = None,
    step_path: Path | None = None,
) -> bool:
    """Rebuild generated CAD previews as smooth PBR solids, not OCC vertex-color meshes.

    FreeCAD / RWGltf_CafWriter emit COLOR_0 greys and zero PBR materials. The
    viewport then treats the file like a faceted mesh. Prefer a sibling STEP
    retessellation (one mesh per solid + Jake palette PBR).
    """
    dest = Path(path)
    if not dest.is_file() or dest.suffix.lower() not in {".glb", ".gltf"}:
        return False
    step = Path(step_path) if step_path else None
    if step is None or not step.is_file():
        for ext in (".step", ".stp"):
            candidate = dest.with_suffix(ext)
            if candidate.is_file():
                step = candidate
                break
    if step is not None and step.is_file():
        try:
            parts = list_step_solid_meshes(step)
        except Exception as exc:
            logger.debug("Could not retessellate %s for polish: %s", step.name, exc)
            parts = []
        if parts and len(parts) < 150:
            sibling_labels: list[str] = []
            try:
                stem = dest.stem
                siblings = sorted(dest.parent.glob(f"{stem}__part_*.step")) or sorted(
                    dest.parent.glob(f"{stem}__part_*.glb")
                )
                for sibling in siblings:
                    match = re.search(r"__part_\d+_(.+)$", sibling.stem, flags=re.I)
                    sibling_labels.append(
                        (match.group(1) if match else sibling.stem).replace("_", " ").strip()
                    )
                if not sibling_labels:
                    sibling_labels = []
            except Exception:
                sibling_labels = []
            scene = trimesh.Scene()
            used: set[str] = set()
            face_dump_parts = len(parts) >= 150
            dump_paint = _semantic_color_for_name(seed or dest.stem)
            if dump_paint is None:
                dump_paint = SHOP_APPEARANCE_PALETTE[0].copy()
            for idx, (label, mesh) in enumerate(parts, start=1):
                display = " ".join(
                    str(
                        (sibling_labels[idx - 1] if idx - 1 < len(sibling_labels) else "")
                        or label
                        or seed
                        or dest.stem
                        or f"Body {idx}"
                    ).split()
                ).strip()[:64]
                geom = re.sub(r"[^\w\-]+", "_", display).strip("_") or f"body_{idx:02d}"
                if geom in used:
                    geom = f"{geom}_{idx:02d}"
                used.add(geom)
                snap = _snapshot_face_colors(mesh)
                paint = None
                if snap is not None and len(snap) and not _colors_are_default_grey(snap):
                    paint = np.asarray(snap[0], dtype=np.uint8)
                else:
                    paint = _semantic_color_for_name(display)
                    hexes = _prompt_hex_colors(prompt)
                    if paint is None and hexes:
                        paint = hexes[(idx - 1) % len(hexes)]
                    if paint is None:
                        rgba = SHOP_ASSEMBLY_PART_PALETTE[(idx - 1) % len(SHOP_ASSEMBLY_PART_PALETTE)]
                        paint = np.array([int(round(c * 255)) for c in rgba[:4]], dtype=np.uint8)
                scene.add_geometry(
                    _mesh_with_cad_pbr(mesh, paint, name=display),
                    geom_name=geom,
                    node_name=display,
                )
            try:
                export_scene(scene, dest)
                return True
            except Exception as exc:
                logger.debug("Could not export polished CAD GLB (%s): %s", dest.name, exc)

    try:
        scene = trimesh.load(dest, force="scene")
    except Exception as exc:
        logger.debug("Could not open GLB to polish (%s): %s", dest.name, exc)
        return False
    if not isinstance(scene, trimesh.Scene):
        try:
            apply_prompt_appearance_to_file(dest, prompt, seed=seed or dest.stem)
            return True
        except Exception:
            return False
    if _is_occ_face_dump_scene(scene):
        return False
    rebuilt = scene.copy()
    for idx, (name, geom) in enumerate(scene.geometry.items(), start=1):
        display = " ".join(str(name or seed or dest.stem or f"Body {idx}").split()).strip()[:64]
        if isinstance(geom, trimesh.Trimesh):
            rebuilt.geometry[name] = _mesh_with_cad_pbr(geom, name=display)
    try:
        export_scene(rebuilt, dest)
        return True
    except Exception as exc:
        logger.debug("Could not rewrite polished GLB (%s): %s", dest.name, exc)
        return False


def export_mesh(mesh: trimesh.Trimesh, path: Path, *, appearance_seed: str | None = None) -> Path:
    suffix = path.suffix.lower()
    if suffix not in SUPPORTED_EXPORT:
        path = path.with_suffix(".glb")
        suffix = ".glb"
    seed = appearance_seed if appearance_seed is not None else path.stem
    # Strip assembly__part_NN_ prefixes so semantic material matching uses the
    # body name (bolt, rubber, …) instead of the project/assembly stem.
    seed_match = re.search(r"__part_\d+_(.+)$", str(seed), flags=re.I)
    if seed_match:
        seed = seed_match.group(1) or seed
    out = _ensure_default_appearance(mesh, seed=seed) if suffix in {".glb", ".gltf", ".3mf"} else mesh
    if suffix == ".3mf":
        scene = trimesh.Scene()
        scene.add_geometry(out, geom_name=path.stem, node_name=path.stem)
        return export_scene_3mf(scene, path)
    if suffix in {".glb", ".gltf"} and _snapshot_face_colors(out) is not None:
        out = _bake_face_colors_to_vertices(out)
    path.parent.mkdir(parents=True, exist_ok=True)
    if suffix in {".glb", ".gltf"}:
        sanitize_trimesh_finite(out)
        out.export(path)
        from backend.services.json_finite import rewrite_glb_finite_json

        rewrite_glb_finite_json(path)
        return path
    out.export(path)
    return path


def _step_manifold_solid_names(step_path: Path) -> list[str]:
    """Fusion body names from ``MANIFOLD_SOLID_BREP('Pillar', ...)`` entities."""
    try:
        text = Path(step_path).read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return []
    names: list[str] = []
    for raw in re.findall(r"MANIFOLD_SOLID_BREP\('([^']*)'", text):
        label = " ".join(str(raw or "").split()).strip()
        names.append(label or f"Body {len(names) + 1}")
    return names


def _quantity_color_to_rgba(color) -> np.ndarray:
    """Convert OCC Quantity_ColorRGBA / Quantity_Color to uint8 RGBA."""
    try:
        rgb = color.GetRGB() if hasattr(color, "GetRGB") else color
        r = float(rgb.Red())
        g = float(rgb.Green())
        b = float(rgb.Blue())
        a = float(color.Alpha()) if hasattr(color, "Alpha") else 1.0
    except Exception:
        return np.array([196, 196, 196, 255], dtype=np.uint8)
    if max(r, g, b) <= 1.5:
        r, g, b = r * 255.0, g * 255.0, b * 255.0
    if a <= 1.5:
        a = a * 255.0
    return np.array(
        [
            int(round(min(255.0, max(0.0, r)))),
            int(round(min(255.0, max(0.0, g)))),
            int(round(min(255.0, max(0.0, b)))),
            int(round(min(255.0, max(0.0, a)))),
        ],
        dtype=np.uint8,
    )


def _xcaf_color_from_label(color_tool, label) -> np.ndarray | None:
    from OCP.Quantity import Quantity_ColorRGBA
    from OCP.XCAFDoc import XCAFDoc_ColorCurv, XCAFDoc_ColorGen, XCAFDoc_ColorSurf, XCAFDoc_ColorTool

    color = Quantity_ColorRGBA()
    for color_type in (XCAFDoc_ColorSurf, XCAFDoc_ColorGen, XCAFDoc_ColorCurv):
        try:
            if XCAFDoc_ColorTool.GetColor_s(label, color_type, color):
                return _quantity_color_to_rgba(color)
        except Exception:
            continue
    return None


def _xcaf_color_for_shape(color_tool, shape) -> np.ndarray | None:
    """Best-effort Fusion / STEP appearance colour for a solid or face set."""
    if shape is None or getattr(shape, "IsNull", lambda: True)():
        return None
    from OCP.Quantity import Quantity_ColorRGBA
    from OCP.TopAbs import TopAbs_FACE
    from OCP.TopExp import TopExp_Explorer
    from OCP.XCAFDoc import XCAFDoc_ColorCurv, XCAFDoc_ColorGen, XCAFDoc_ColorSurf

    color = Quantity_ColorRGBA()
    for color_type in (XCAFDoc_ColorSurf, XCAFDoc_ColorGen, XCAFDoc_ColorCurv):
        for getter in ("GetColor", "GetInstanceColor"):
            try:
                fn = getattr(color_tool, getter, None)
                if fn and fn(shape, color_type, color):
                    return _quantity_color_to_rgba(color)
            except Exception:
                continue

    # Majority face colour (Fusion often colours faces / bodies this way).
    votes: dict[tuple[int, int, int, int], int] = {}
    exp = TopExp_Explorer(shape, TopAbs_FACE)
    while exp.More():
        face = exp.Current()
        found = None
        for color_type in (XCAFDoc_ColorSurf, XCAFDoc_ColorGen, XCAFDoc_ColorCurv):
            for getter in ("GetColor", "GetInstanceColor"):
                try:
                    fn = getattr(color_tool, getter, None)
                    if fn and fn(face, color_type, color):
                        found = _quantity_color_to_rgba(color)
                        break
                except Exception:
                    continue
            if found is not None:
                break
        if found is not None:
            key = (int(found[0]), int(found[1]), int(found[2]), int(found[3]))
            votes[key] = votes.get(key, 0) + 1
        exp.Next()
    if votes:
        best = max(votes.items(), key=lambda item: item[1])[0]
        return np.array(best, dtype=np.uint8)
    return None


def _paint_mesh_rgba(mesh: trimesh.Trimesh, rgba: np.ndarray | None) -> trimesh.Trimesh:
    if mesh is None or rgba is None:
        return mesh
    faces = getattr(mesh, "faces", None)
    try:
        n_faces = 0 if faces is None else int(len(faces))
    except Exception:
        n_faces = 0
    if n_faces < 1:
        return mesh
    m = mesh_copy(mesh)
    m.visual.face_colors = np.tile(np.asarray(rgba, dtype=np.uint8)[:4], (n_faces, 1))
    return m


def _mesh_has_authored_color(mesh: trimesh.Trimesh) -> bool:
    colors = _snapshot_face_colors(mesh)
    return colors is not None and not _colors_are_default_grey(colors)


def _rgba_u8_from_geometry(geom) -> np.ndarray | None:
    """Extract a representative uint8 RGBA from a trimesh geometry."""
    try:
        mat = getattr(getattr(geom, "visual", None), "material", None)
        factor = getattr(mat, "baseColorFactor", None) if mat is not None else None
        if factor is not None:
            arr = np.asarray(factor, dtype=float).reshape(-1)
            if arr.size >= 3:
                if arr.max() <= 1.5:
                    arr = arr * 255.0
                a = float(arr[3]) if arr.size > 3 else 255.0
                if a <= 1.5:
                    a *= 255.0
                return np.array(
                    [int(round(arr[0])), int(round(arr[1])), int(round(arr[2])), int(round(a))],
                    dtype=np.uint8,
                )
    except Exception:
        pass
    try:
        vc = getattr(getattr(geom, "visual", None), "vertex_colors", None)
        if vc is not None and len(vc):
            mean = np.asarray(vc, dtype=float).mean(axis=0)
            if mean.max() <= 1.5:
                mean = mean * 255.0
            if mean.shape[0] == 3:
                mean = np.append(mean, 255.0)
            return mean[:4].astype(np.uint8)
    except Exception:
        pass
    try:
        fc = getattr(getattr(geom, "visual", None), "face_colors", None)
        if fc is not None and len(fc):
            mean = np.asarray(fc, dtype=float).mean(axis=0)
            if mean.max() <= 1.5:
                mean = mean * 255.0
            if mean.shape[0] == 3:
                mean = np.append(mean, 255.0)
            return mean[:4].astype(np.uint8)
    except Exception:
        pass
    return None


def _sample_glb_appearance_patches(glb_path: Path) -> list[tuple[np.ndarray, np.ndarray, np.ndarray]]:
    """Return ``(centroid, half_extents, rgba_u8)`` samples from a colour-aware GLB."""
    path = Path(glb_path)
    if not path.is_file():
        return []
    try:
        scene = trimesh.load(path, force="scene")
    except Exception:
        return []
    if not isinstance(scene, trimesh.Scene):
        return []
    patches: list[tuple[np.ndarray, np.ndarray, np.ndarray]] = []
    for name, geom in scene.geometry.items():
        rgba = _rgba_u8_from_geometry(geom)
        if rgba is None:
            continue
        rgb = rgba[:3].astype(float)
        if float(np.max(rgb) - np.min(rgb)) < 6 and 90 <= float(rgb.mean()) <= 220:
            continue
        try:
            matched = False
            for frame in scene.graph.nodes_geometry:
                transform, geoname = scene.graph.get(frame)
                if geoname != name:
                    continue
                verts = np.asarray(geom.vertices, dtype=float)
                if not len(verts):
                    continue
                ones = np.ones((len(verts), 1))
                world = (np.asarray(transform, dtype=float) @ np.hstack([verts, ones]).T).T[:, :3]
                centroid = world.mean(axis=0)
                half = (world.max(axis=0) - world.min(axis=0)) * 0.5
                patches.append((centroid, np.maximum(half, 0.5), rgba))
                matched = True
                break
            if not matched:
                verts = np.asarray(geom.vertices, dtype=float)
                if not len(verts):
                    continue
                centroid = verts.mean(axis=0)
                half = (verts.max(axis=0) - verts.min(axis=0)) * 0.5
                patches.append((centroid, np.maximum(half, 0.5), rgba))
        except Exception:
            continue
    return patches


def _paint_solids_from_glb_appearance(
    parts: list[tuple[str, trimesh.Trimesh]],
    glb_path: Path | None,
) -> list[tuple[str, trimesh.Trimesh]]:
    """Transfer Fusion/XCAF colours from a coloured GLB onto STEP solid meshes."""
    if not parts or not glb_path:
        return parts
    patches = _sample_glb_appearance_patches(Path(glb_path))
    if not patches:
        return parts
    painted: list[tuple[str, trimesh.Trimesh]] = []
    for label, mesh in parts:
        if mesh.metadata.get("fusion_color") and _mesh_has_authored_color(mesh):
            painted.append((label, mesh))
            continue
        try:
            bounds = np.asarray(mesh.bounds, dtype=float)
            centroid = np.asarray(mesh.centroid, dtype=float)
        except Exception:
            painted.append((label, mesh))
            continue
        votes: dict[tuple[int, int, int, int], int] = {}
        for patch_c, half, rgba in patches:
            lo = bounds[0] - half * 0.35
            hi = bounds[1] + half * 0.35
            if np.all(patch_c >= lo) and np.all(patch_c <= hi):
                key = (int(rgba[0]), int(rgba[1]), int(rgba[2]), int(rgba[3]))
                votes[key] = votes.get(key, 0) + 1
        if votes:
            best = max(votes.items(), key=lambda item: item[1])[0]
            rgba = np.array(best, dtype=np.uint8)
        else:
            dists = [float(np.linalg.norm(patch_c - centroid)) for patch_c, _, _ in patches]
            rgba = patches[int(np.argmin(dists))][2]
        mesh2 = _paint_mesh_rgba(mesh, rgba)
        mesh2.metadata["name"] = label
        mesh2.metadata["fusion_color"] = [int(x) for x in rgba.tolist()]
        painted.append((label, mesh2))
    return painted


def _tessellate_shape_to_mesh(
    shape,
    *,
    linear_deflection: float = 0.05,
    angular_deflection: float = 0.12,
) -> trimesh.Trimesh:
    """Tessellate one OpenCascade shape the way FreeCAD / VibeCAD Coin3D does.

    Mesh **per BRep face** and do not weld vertices across faces. That keeps
    sharp CAD edges (rims, flanges, holes) instead of Gouraud-melting them.
    """
    from OCP.BRep import BRep_Tool
    from OCP.BRepMesh import BRepMesh_IncrementalMesh
    from OCP.TopAbs import TopAbs_FACE, TopAbs_REVERSED
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopLoc import TopLoc_Location
    from OCP.TopoDS import TopoDS

    if shape is None or shape.IsNull():
        raise ValueError("Cannot tessellate an empty shape")
    BRepMesh_IncrementalMesh(shape, float(linear_deflection), False, float(angular_deflection), True)

    vertices: list[list[float]] = []
    normals: list[list[float]] = []
    faces: list[list[int]] = []
    explorer = TopExp_Explorer(shape, TopAbs_FACE)
    while explorer.More():
        face = TopoDS.Face_s(explorer.Current())
        location = TopLoc_Location()
        triangulation = BRep_Tool.Triangulation_s(face, location)
        if triangulation is None:
            explorer.Next()
            continue
        try:
            if not triangulation.HasNormals():
                triangulation.ComputeNormals()
        except Exception:
            pass
        reversed_face = face.Orientation() == TopAbs_REVERSED
        trsf = location.Transformation()
        offset = len(vertices)
        node_count = int(triangulation.NbNodes())
        for index in range(1, node_count + 1):
            point = triangulation.Node(index).Transformed(trsf)
            vertices.append([float(point.X()), float(point.Y()), float(point.Z())])
            nx = ny = nz = 0.0
            try:
                normal = triangulation.Normal(index).Transformed(trsf)
                nx, ny, nz = float(normal.X()), float(normal.Y()), float(normal.Z())
                if reversed_face:
                    nx, ny, nz = -nx, -ny, -nz
                length = math.sqrt((nx * nx) + (ny * ny) + (nz * nz))
                if length > 1e-15:
                    nx, ny, nz = nx / length, ny / length, nz / length
                else:
                    nx, ny, nz = 0.0, 0.0, 1.0
            except Exception:
                nx, ny, nz = 0.0, 0.0, 1.0
            normals.append([nx, ny, nz])
        for index in range(1, int(triangulation.NbTriangles()) + 1):
            node_a, node_b, node_c = triangulation.Triangle(index).Get()
            tri = [offset + node_a - 1, offset + node_b - 1, offset + node_c - 1]
            if reversed_face:
                tri[1], tri[2] = tri[2], tri[1]
            faces.append(tri)
        explorer.Next()

    if not vertices or not faces:
        return _tessellate_shape_to_mesh_stl(
            shape,
            linear_deflection=linear_deflection,
            angular_deflection=angular_deflection,
        )
    mesh = trimesh.Trimesh(
        vertices=np.asarray(vertices, dtype=np.float64),
        faces=np.asarray(faces, dtype=np.int64),
        vertex_normals=np.asarray(normals, dtype=np.float64),
        process=False,
    )
    if mesh.is_empty or len(mesh.faces) < 1:
        raise ValueError("Could not tessellate CAD shape")
    return mesh


def _tessellate_shape_to_mesh_stl(
    shape,
    *,
    linear_deflection: float,
    angular_deflection: float,
) -> trimesh.Trimesh:
    """STL fallback when per-face triangulation is missing."""
    from OCP.BRepMesh import BRepMesh_IncrementalMesh
    from OCP.StlAPI import StlAPI_Writer
    import tempfile

    BRepMesh_IncrementalMesh(shape, float(linear_deflection), False, float(angular_deflection), True)
    with tempfile.NamedTemporaryFile(suffix=".stl", delete=False) as tmp:
        tmp_path = Path(tmp.name)
    try:
        writer = StlAPI_Writer()
        if not writer.Write(shape, str(tmp_path)):
            raise ValueError("Could not tessellate CAD shape")
        loaded = load_mesh(tmp_path)
        return _crease_split_cad_mesh(loaded)
    finally:
        tmp_path.unlink(missing_ok=True)


def list_step_solid_meshes(
    step_path: Path,
    *,
    linear_deflection: float = 0.05,
    angular_deflection: float = 0.12,
) -> list[tuple[str, trimesh.Trimesh]]:
    """Return ``(label, mesh)`` for each solid body in a STEP file.

    Fusion designs often export as one free shape containing several solids. The
    XCAF→GLB writer then fragments those into dozens of mesh nodes; splitting the
    GLB scene over-counts parts. Solid-level split matches what users can select
    in Fusion.

    When STEP/XCAF carries Fusion appearance colours, they are baked onto each
    solid mesh so body-split imports keep the Fusion look instead of rainbow
    palette colours.
    """
    from OCP.IFSelect import IFSelect_ReturnStatus
    from OCP.STEPCAFControl import STEPCAFControl_Reader
    from OCP.STEPControl import STEPControl_Reader
    from OCP.TCollection import TCollection_ExtendedString
    from OCP.TDataStd import TDataStd_Name
    from OCP.TDocStd import TDocStd_Document
    from OCP.TopAbs import TopAbs_SOLID
    from OCP.TopExp import TopExp_Explorer
    from OCP.XCAFApp import XCAFApp_Application
    from OCP.XCAFDoc import XCAFDoc_DocumentTool, XCAFDoc_ShapeTool
    from OCP.TDF import TDF_LabelSequence

    step_path = Path(step_path)
    solids: list[tuple[str, Any, np.ndarray | None]] = []

    def _label_name(lab) -> str:
        attr = TDataStd_Name()
        if lab.FindAttribute(TDataStd_Name.GetID_s(), attr):
            text = str(attr.Get().ToExtString() or "").strip()
            if text:
                return text
        return ""

    try:
        app = XCAFApp_Application.GetApplication_s()
        fmt = TCollection_ExtendedString("BinXCAF")
        doc = TDocStd_Document(fmt)
        app.NewDocument(fmt, doc)
        reader = STEPCAFControl_Reader()
        reader.SetColorMode(True)
        reader.SetNameMode(True)
        status = reader.ReadFile(str(step_path))
        if status != IFSelect_ReturnStatus.IFSelect_RetDone:
            raise ValueError(f"STEPCAFControl_Reader failed on {step_path.name}")
        reader.Transfer(doc)
        shape_tool = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
        color_tool = XCAFDoc_DocumentTool.ColorTool_s(doc.Main())
        labels = TDF_LabelSequence()
        shape_tool.GetFreeShapes(labels)
        for i in range(1, labels.Size() + 1):
            lab = labels.Value(i)
            root_name = _label_name(lab) or step_path.stem
            root_color = _xcaf_color_from_label(color_tool, lab)
            shape = XCAFDoc_ShapeTool.GetShape_s(lab)
            if shape.IsNull():
                continue
            exp = TopExp_Explorer(shape, TopAbs_SOLID)
            solid_i = 0
            while exp.More():
                solid_i += 1
                solid = exp.Current()
                solid_color = _xcaf_color_for_shape(color_tool, solid) or root_color
                solids.append((f"{root_name} body {solid_i}", solid, solid_color))
                exp.Next()
            if solid_i == 0:
                solids.append((root_name, shape, root_color or _xcaf_color_for_shape(color_tool, shape)))
    except Exception as exc:
        logger.debug("XCAF solid listing failed for %s (%s); using STEPControl", step_path.name, exc)
        solids = []
        reader = STEPControl_Reader()
        status = reader.ReadFile(str(step_path))
        if status != IFSelect_ReturnStatus.IFSelect_RetDone:
            raise ValueError(f"Could not read STEP file: {step_path.name}") from exc
        reader.TransferRoots()
        shape = reader.OneShape()
        if shape.IsNull():
            raise ValueError(f"STEP file has no geometry: {step_path.name}") from exc
        exp = TopExp_Explorer(shape, TopAbs_SOLID)
        solid_i = 0
        while exp.More():
            solid_i += 1
            solids.append((f"{step_path.stem} body {solid_i}", exp.Current(), None))
            exp.Next()
        if solid_i == 0:
            solids.append((step_path.stem, shape, None))

    # Prefer Fusion/cadpy body names: named BREPs, then STEP occurrences / PRODUCTs.
    named = _authored_step_body_names(step_path)
    if named and len(named) == len(solids):
        solids = [(named[i] or label, shape, color) for i, (label, shape, color) in enumerate(solids)]
    elif named and len(named) > 1 and len(solids) > 1:
        for i in range(min(len(named), len(solids))):
            if named[i] and not _is_generic_gltf_body_id(named[i]):
                solids[i] = (named[i], solids[i][1], solids[i][2])

    meshes: list[tuple[str, trimesh.Trimesh]] = []
    for label, shape, authored_color in solids:
        try:
            mesh = _tessellate_shape_to_mesh(
                shape,
                linear_deflection=linear_deflection,
                angular_deflection=angular_deflection,
            )
        except Exception as exc:
            logger.warning("Skipping STEP solid %s in %s: %s", label, step_path.name, exc)
            continue
        if mesh is None or mesh.is_empty or len(mesh.faces) < 1:
            continue
        # Prefer Fusion/XCAF colour; otherwise a semantic material colour from the
        # body name (bolt → steel grey, rubber → black, …) instead of a random hue.
        paint = authored_color if authored_color is not None else _semantic_color_for_name(label)
        if paint is not None:
            mesh = _paint_mesh_rgba(mesh, paint)
        mesh.metadata["name"] = label
        if authored_color is not None:
            mesh.metadata["fusion_color"] = [int(x) for x in authored_color.tolist()]
        meshes.append((label, mesh))
    return meshes


def rebuild_shell_glb_from_parts(
    shell_path: Path,
    parts: list[tuple[str, trimesh.Trimesh]],
) -> Path:
    """Write a multi-mesh shell GLB so viewport body selection matches Fusion solids."""
    shell_path = Path(shell_path)
    scene = trimesh.Scene()
    used: set[str] = set()
    for idx, (label, mesh) in enumerate(parts, start=1):
        display = " ".join(str(label or "").split()).strip()[:64] or f"Body {idx}"
        geom = re.sub(r"[^\w\-]+", "_", display).strip("_") or f"body_{idx:02d}"
        if geom in used:
            geom = f"{geom}_{idx:02d}"
        used.add(geom)
        copied = mesh_copy(mesh)
        copied.metadata["name"] = display
        # Keep Fusion body names on the scene node so single-click selection labels match.
        scene.add_geometry(copied, geom_name=geom, node_name=display)
    return export_scene(scene, shell_path)


def split_step_solids_to_glbs(
    step_path: Path,
    project_path: Path,
    *,
    base_stem: str | None = None,
    shell_glb_path: Path | None = None,
    max_parts: int = 256,
) -> list[str]:
    """Split a STEP file into one ``__part_*.glb`` per solid and rebuild the shell."""
    step_path = Path(step_path)
    project_path = Path(project_path)
    raw_base = str(base_stem or step_path.stem or "component")
    base = re.sub(r"[^\w\-]+", "_", raw_base).strip("_") or "component"
    base = base[:80]
    parts = list_step_solid_meshes(step_path)
    if len(parts) <= 1:
        return []

    # Prefer the colour-aware Autodesk/XCAF preview GLB over the shell (the shell
    # may already have been washed by an earlier split).
    color_sources: list[Path] = []
    autodesk_glb = project_path / f".autodesk_source_{base}.glb"
    if autodesk_glb.is_file():
        color_sources.append(autodesk_glb)
    for candidate in sorted(project_path.glob(".autodesk_source_*.glb")):
        if candidate not in color_sources:
            color_sources.append(candidate)
    if shell_glb_path and Path(shell_glb_path).is_file():
        shell_p = Path(shell_glb_path)
        if shell_p not in color_sources:
            color_sources.append(shell_p)
    for source in color_sources:
        before = sum(1 for _, m in parts if m.metadata.get("fusion_color"))
        # Skip washed shells: need real colour variety before we trust them.
        patches = _sample_glb_appearance_patches(source)
        unique = {
            (int(rgba[0]), int(rgba[1]), int(rgba[2]))
            for _, _, rgba in patches
        }
        if source.name.startswith(".autodesk_source_") or len(unique) >= 2:
            parts = _paint_solids_from_glb_appearance(parts, source)
        after = sum(1 for _, m in parts if m.metadata.get("fusion_color"))
        if after > before:
            logger.info(
                "Transferred %d Fusion appearance colour(s) from %s onto STEP solids",
                after - before,
                source.name,
            )
            break

    for old in project_path.glob(f"{base}__part_*.glb"):
        try:
            old.unlink(missing_ok=True)
        except OSError:
            pass

    outputs: list[str] = []
    used: set[str] = set()
    kept: list[tuple[str, trimesh.Trimesh]] = []
    authored_count = 0
    for idx, (label, mesh) in enumerate(parts[: max(1, int(max_parts))], start=1):
        slug = re.sub(r"[^\w\-]+", "_", str(label or "").lower()).strip("_")[:48] or f"part_{idx:02d}"
        if slug in used:
            slug = f"{slug}_{idx:02d}"
        used.add(slug)
        out_name = f"{base}__part_{idx:02d}_{slug}.glb"
        # Ensure the mesh we keep for the shell matches what we export.
        # Use the body label (not food_robot__part_…) so semantic colours stay
        # grounded in the part name instead of the assembly filename.
        if not _mesh_has_authored_color(mesh):
            mesh = _ensure_default_appearance(mesh, seed=label or slug)
        if _mesh_has_authored_color(mesh):
            authored_count += 1
        # Pass label seed into export so path stems like food_robot__part_* do
        # not override Fusion colours with a "food" semantic match.
        export_mesh(mesh, project_path / out_name, appearance_seed=label or slug)
        outputs.append(out_name)
        kept.append((label, mesh))

    if shell_glb_path is not None and kept:
        try:
            rebuild_shell_glb_from_parts(Path(shell_glb_path), kept)
            # Never rainbow-overwrite Fusion / STEP appearance colours.
            if authored_count < max(1, len(kept) // 4):
                colorize_assembly_glb_parts(Path(shell_glb_path))
        except Exception as exc:
            logger.warning("Could not rebuild shell GLB %s from STEP solids: %s", Path(shell_glb_path).name, exc)
    return outputs

def split_scene_components_to_glbs(
    viewer_path: Path,
    project_path: Path,
    *,
    base_stem: str | None = None,
    max_parts: int = 256,
    step_path: Path | None = None,
) -> list[str]:
    """Export each named GLB scene component as ``{base}__part_NN_slug.glb``.

    Used by Fusion / Autodesk import when ``import_bodies`` is requested. Returns
    an empty list when the viewer has only one body (nothing useful to split).

    Prefer STEP solid split when a source STEP is available — Fusion bodies map to
    solids, while XCAF GLB nodes are often over-fragmented face pieces.
    """
    viewer_path = Path(viewer_path)
    project_path = Path(project_path)
    raw_base = str(base_stem or viewer_path.stem or "component")
    base = re.sub(r"[^\w\-]+", "_", raw_base).strip("_") or "component"
    base = base[:80]

    if step_path is not None and Path(step_path).is_file():
        try:
            step_parts = split_step_solids_to_glbs(
                Path(step_path),
                project_path,
                base_stem=base,
                shell_glb_path=viewer_path,
                max_parts=max_parts,
            )
            if len(step_parts) > 1:
                return step_parts
        except Exception as exc:
            logger.warning("STEP solid split failed for %s: %s", Path(step_path).name, exc)

    if not viewer_path.is_file():
        raise FileNotFoundError(f"Viewer GLB missing: {viewer_path.name}")

    scene = load_scene(viewer_path)
    parts = _meshes_from_scene(scene)
    # Drop degenerate OCC face shards (2-triangle walls that aren't selectable Fusion bodies).
    meaningful = [
        (label, mesh)
        for label, mesh in parts
        if mesh is not None and not mesh.is_empty and len(getattr(mesh, "faces", [])) >= 8
    ]
    if len(meaningful) > 1:
        parts = meaningful
    if len(parts) <= 1:
        mesh = parts[0][1] if parts else load_mesh(viewer_path)
        bodies = _mesh_bodies(mesh)
        bodies = [b for b in bodies if b is not None and not b.is_empty and len(b.faces) >= 8]
        if len(bodies) <= 1:
            return []
        parts = [(f"body_{i:02d}", body) for i, body in enumerate(bodies, start=1)]

    for old in project_path.glob(f"{base}__part_*.glb"):
        try:
            old.unlink(missing_ok=True)
        except OSError:
            pass

    outputs: list[str] = []
    used: set[str] = set()
    kept: list[tuple[str, trimesh.Trimesh]] = []
    for idx, (label, mesh) in enumerate(parts[: max(1, int(max_parts))], start=1):
        slug = re.sub(r"[^\w\-]+", "_", str(label or "").lower()).strip("_")[:48] or f"part_{idx:02d}"
        if slug in used:
            slug = f"{slug}_{idx:02d}"
        used.add(slug)
        out_name = f"{base}__part_{idx:02d}_{slug}.glb"
        export_mesh(mesh, project_path / out_name)
        outputs.append(out_name)
        kept.append((label, mesh))
    if kept and len(kept) > 1:
        try:
            rebuild_shell_glb_from_parts(viewer_path, kept)
            colorize_assembly_glb_parts(viewer_path, force=True)
        except Exception as exc:
            logger.debug("Could not rebuild shell after scene split for %s: %s", viewer_path.name, exc)
    return outputs


def _compose_pivot_matrix(transform: dict[str, Any], center: np.ndarray) -> np.ndarray:
    """Build a 4x4 matrix matching ``apply_transform`` (scale/rotate about center, then translate)."""
    center = np.asarray(center, dtype=float).reshape(3)
    matrix = np.eye(4, dtype=float)
    has_scale = "scale" in transform
    has_rot = "rotation_deg" in transform
    if has_scale or has_rot:
        to_origin = trimesh.transformations.translation_matrix(-center)
        back = trimesh.transformations.translation_matrix(center)
        local = np.eye(4, dtype=float)
        if has_scale:
            local = trimesh.transformations.scale_matrix(float(transform["scale"])) @ local
        if has_rot:
            r = np.radians(transform["rotation_deg"])
            local = trimesh.transformations.euler_matrix(r[0], r[1], r[2], axes="sxyz") @ local
        matrix = back @ local @ to_origin
    if "translation" in transform:
        matrix = trimesh.transformations.translation_matrix(np.asarray(transform["translation"], dtype=float)) @ matrix
    return matrix


_GLB_JSON_CHUNK = 0x4E4F534A


def _read_glb_document(path: Path) -> tuple[dict[str, Any], int, list[tuple[int, bytes]]]:
    """Read a GLB without interpreting or rewriting its binary payload."""
    data = Path(path).read_bytes()
    if len(data) < 20 or data[:4] != b"glTF":
        raise ValueError(f"Not a binary glTF file: {Path(path).name}")
    _magic, version, declared_length = struct.unpack_from("<4sII", data, 0)
    if version != 2 or declared_length > len(data):
        raise ValueError(f"Unsupported or truncated GLB: {Path(path).name}")
    chunks: list[tuple[int, bytes]] = []
    document: dict[str, Any] | None = None
    offset = 12
    while offset + 8 <= declared_length:
        length, chunk_type = struct.unpack_from("<II", data, offset)
        offset += 8
        payload = data[offset : offset + length]
        if len(payload) != length:
            raise ValueError(f"Truncated GLB chunk: {Path(path).name}")
        offset += length
        chunks.append((chunk_type, payload))
        if chunk_type == _GLB_JSON_CHUNK and document is None:
            parsed = json.loads(payload.decode("utf-8").rstrip(" \t\r\n\x00"))
            if not isinstance(parsed, dict):
                raise ValueError(f"Invalid GLB JSON document: {Path(path).name}")
            document = parsed
    if document is None:
        raise ValueError(f"GLB has no JSON document: {Path(path).name}")
    return document, version, chunks


def _write_glb_document(
    source: Path,
    destination: Path,
    document: dict[str, Any],
    *,
    version: int,
    chunks: list[tuple[int, bytes]],
) -> Path:
    """Atomically replace only the JSON chunk, preserving every other GLB chunk."""
    encoded = json.dumps(document, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
    encoded += b" " * ((4 - len(encoded) % 4) % 4)
    output_chunks: list[bytes] = []
    replaced = False
    for chunk_type, payload in chunks:
        if chunk_type == _GLB_JSON_CHUNK and not replaced:
            payload = encoded
            replaced = True
        output_chunks.append(struct.pack("<II", len(payload), chunk_type) + payload)
    if not replaced:
        output_chunks.insert(0, struct.pack("<II", len(encoded), _GLB_JSON_CHUNK) + encoded)
    body = b"".join(output_chunks)
    raw = struct.pack("<4sII", b"glTF", version, 12 + len(body)) + body
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f".{destination.name}.{uuid.uuid4().hex}.tmp")
    try:
        temporary.write_bytes(raw)
        os.replace(temporary, destination)
    finally:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass
    return destination


def _gltf_node_local_matrix(node: dict[str, Any]) -> np.ndarray:
    raw_matrix = node.get("matrix")
    if isinstance(raw_matrix, list) and len(raw_matrix) == 16:
        return np.asarray(raw_matrix, dtype=float).reshape((4, 4)).T
    matrix = np.eye(4, dtype=float)
    scale = node.get("scale")
    if isinstance(scale, list) and len(scale) >= 3:
        matrix = np.diag([float(scale[0]), float(scale[1]), float(scale[2]), 1.0]) @ matrix
    rotation = node.get("rotation")
    if isinstance(rotation, list) and len(rotation) >= 4:
        x, y, z, w = (float(rotation[index]) for index in range(4))
        matrix = trimesh.transformations.quaternion_matrix([w, x, y, z]) @ matrix
    translation = node.get("translation")
    if isinstance(translation, list) and len(translation) >= 3:
        matrix = trimesh.transformations.translation_matrix(
            [float(translation[0]), float(translation[1]), float(translation[2])]
        ) @ matrix
    return matrix


def _gltf_scene_graph(
    document: dict[str, Any],
) -> tuple[dict[str, Any], list[dict[str, Any]], dict[int, int | None], dict[int, np.ndarray]]:
    nodes = document.setdefault("nodes", [])
    scenes = document.setdefault("scenes", [{"nodes": []}])
    scene_index = int(document.get("scene") or 0)
    if scene_index < 0 or scene_index >= len(scenes):
        scene_index = 0
    scene = scenes[scene_index]
    parents: dict[int, int | None] = {}
    worlds: dict[int, np.ndarray] = {}

    def walk(index: int, parent: int | None, parent_world: np.ndarray) -> None:
        if index < 0 or index >= len(nodes) or index in worlds:
            return
        parents[index] = parent
        local = _gltf_node_local_matrix(nodes[index] or {})
        world = parent_world @ local
        worlds[index] = world
        for raw_child in (nodes[index] or {}).get("children") or []:
            try:
                walk(int(raw_child), index, world)
            except (TypeError, ValueError):
                continue

    for raw_root in scene.get("nodes") or []:
        try:
            walk(int(raw_root), None, np.eye(4, dtype=float))
        except (TypeError, ValueError):
            continue
    return scene, nodes, parents, worlds


def _gltf_mesh_node_indices(document: dict[str, Any]) -> list[int]:
    scene, nodes, _parents, _worlds = _gltf_scene_graph(document)
    ordered: list[int] = []

    def walk(index: int) -> None:
        if index < 0 or index >= len(nodes):
            return
        node = nodes[index] or {}
        if "mesh" in node:
            ordered.append(index)
        for raw_child in node.get("children") or []:
            try:
                walk(int(raw_child))
            except (TypeError, ValueError):
                continue

    for raw_root in scene.get("nodes") or []:
        try:
            walk(int(raw_root))
        except (TypeError, ValueError):
            continue
    return ordered


def _resolve_gltf_mesh_node(
    document: dict[str, Any],
    body_index: int,
    body_name: str | None = None,
) -> int:
    nodes = document.get("nodes") or []
    meshes = document.get("meshes") or []
    ordered = _gltf_mesh_node_indices(document)
    if body_name:
        wanted = _normalize_body_key(body_name)
        for node_index in ordered:
            node = nodes[node_index] or {}
            mesh_index = int(node.get("mesh", -1))
            mesh_name = meshes[mesh_index].get("name") if 0 <= mesh_index < len(meshes) else None
            if _normalize_body_key(node.get("name")) == wanted or _normalize_body_key(mesh_name) == wanted:
                return node_index
        raise ValueError(f"body_name not found: {body_name}")
    index = int(body_index)
    if index < 0 or index >= len(ordered):
        raise ValueError(f"body_index out of range: {index}")
    return ordered[index]


def _gltf_matrix_values(matrix: np.ndarray) -> list[float]:
    return [float(value) for value in np.asarray(matrix, dtype=float).T.reshape(-1)]


def _glb_scene_structure_reasons(path: Path) -> list[str]:
    """Explain why a topology edit cannot safely round-trip through one Trimesh."""
    path = Path(path)
    if path.suffix.lower() != ".glb":
        try:
            scene = load_scene(path)
            entries = _scene_geometry_entries(scene, source_path=path)
            return ["multiple named scene parts"] if len(entries) > 1 else []
        except Exception:
            return []
    document, _version, _chunks = _read_glb_document(path)
    reasons: list[str] = []
    nodes = document.get("nodes") or []
    mesh_nodes = _gltf_mesh_node_indices(document)
    mesh_refs = [int(nodes[index].get("mesh", -1)) for index in mesh_nodes]
    if len(mesh_nodes) > 1:
        reasons.append("multiple named or instanced parts")
    if len(mesh_refs) != len(set(mesh_refs)):
        reasons.append("repeated mesh instances")
    hierarchy_nodes = [node or {} for node in nodes if (node or {}).get("children")]
    meaningful_hierarchy = any(
        node.get("mesh") is not None
        or node.get("extras")
        or set(node) - {"name", "children"}
        or str(node.get("name") or "").strip().lower() not in {"world", "scene"}
        for node in hierarchy_nodes
    )
    if meaningful_hierarchy:
        reasons.append("node hierarchy")
    if document.get("animations"):
        reasons.append("animation clips")
    if document.get("skins"):
        reasons.append("skins")
    if any((node or {}).get("extras") for node in nodes) or any(
        (scene or {}).get("extras") for scene in (document.get("scenes") or [])
    ):
        reasons.append("authored extras")
    materials = document.get("materials") or []
    if len(materials) > 1 or any((material or {}).get("extensions") for material in materials):
        reasons.append("multiple or advanced materials")
    return reasons


def assert_unstructured_mesh_edit_supported(path: Path, operation: str) -> None:
    reasons = _glb_scene_structure_reasons(Path(path))
    if reasons:
        detail = ", ".join(dict.fromkeys(reasons))
        raise ValueError(
            f"{operation} cannot safely edit this structured scene ({detail}). "
            "Export or select one standalone mesh body first."
        )


def _patch_glb_scene_transform(
    source: Path,
    destination: Path,
    matrix: np.ndarray,
    *,
    body_index: int | None = None,
    body_name: str | None = None,
) -> Path:
    document, version, chunks = _read_glb_document(source)
    scene, nodes, parents, worlds = _gltf_scene_graph(document)
    if body_index is None and body_name is None:
        children = [int(index) for index in (scene.get("nodes") or [])]
        wrapper_matrix = matrix
        scene["nodes"] = [len(nodes)]
        label = "Render Studio object transform"
    else:
        target = _resolve_gltf_mesh_node(document, int(body_index or 0), body_name)
        parent = parents.get(target)
        parent_world = worlds.get(parent, np.eye(4, dtype=float)) if parent is not None else np.eye(4, dtype=float)
        wrapper_matrix = np.linalg.inv(parent_world) @ matrix @ parent_world
        children = [target]
        wrapper_index = len(nodes)
        if parent is None:
            scene["nodes"] = [wrapper_index if int(index) == target else int(index) for index in scene.get("nodes") or []]
        else:
            parent_node = nodes[parent]
            parent_node["children"] = [
                wrapper_index if int(index) == target else int(index)
                for index in parent_node.get("children") or []
            ]
        label = "Render Studio body transform"
    nodes.append(
        {
            "name": label,
            "matrix": _gltf_matrix_values(wrapper_matrix),
            "children": children,
            "extras": {"renderStudioTransformWrapper": True},
        }
    )
    return _write_glb_document(source, destination, document, version=version, chunks=chunks)


def _patch_glb_material_color(
    source: Path,
    destination: Path,
    color: Any,
    *,
    body_index: int | None = None,
    body_name: str | None = None,
) -> Path:
    document, version, chunks = _read_glb_document(source)
    nodes = document.get("nodes") or []
    meshes = document.setdefault("meshes", [])
    materials = document.setdefault("materials", [])
    if body_index is None and body_name is None:
        target_nodes = _gltf_mesh_node_indices(document)
    else:
        try:
            target_node = _resolve_gltf_mesh_node(document, int(body_index or 0), body_name)
        except ValueError:
            if body_name and body_index is not None:
                target_node = _resolve_gltf_mesh_node(document, int(body_index), None)
            else:
                raise
        target_nodes = [target_node]
        # A selected instance must not recolor siblings that reference one mesh.
        node = nodes[target_nodes[0]]
        mesh_index = int(node.get("mesh", -1))
        if mesh_index < 0 or mesh_index >= len(meshes):
            raise ValueError("Selected body has no mesh")
        reference_count = sum(
            1
            for candidate in nodes
            if isinstance(candidate, dict) and int(candidate.get("mesh", -1)) == mesh_index
        )
        if reference_count > 1:
            meshes.append(copy.deepcopy(meshes[mesh_index]))
            node["mesh"] = len(meshes) - 1
    rgba = np.asarray(_parse_color(color), dtype=float).reshape(-1)
    factor = [float(value) / 255.0 for value in rgba[:4]]
    while len(factor) < 4:
        factor.append(1.0)
    cloned_materials: dict[tuple[int, int], int] = {}
    for node_index in target_nodes:
        mesh_index = int(nodes[node_index].get("mesh", -1))
        if mesh_index < 0 or mesh_index >= len(meshes):
            continue
        for primitive in meshes[mesh_index].get("primitives") or []:
            # Authored COLOR_0 overrides a material base color in glTF. Whole-body
            # paint intentionally replaces that channel on the selected body.
            attributes = primitive.get("attributes")
            if isinstance(attributes, dict):
                attributes.pop("COLOR_0", None)
            original_index = int(primitive.get("material", -1))
            key = (mesh_index, original_index)
            replacement = cloned_materials.get(key)
            if replacement is None:
                original = materials[original_index] if 0 <= original_index < len(materials) else {}
                patched = copy.deepcopy(original)
                pbr = patched.setdefault("pbrMetallicRoughness", {})
                pbr["baseColorFactor"] = factor
                materials.append(patched)
                replacement = len(materials) - 1
                cloned_materials[key] = replacement
            primitive["material"] = replacement
    if not cloned_materials:
        raise ValueError("Selected body has no paintable primitives")
    return _write_glb_document(source, destination, document, version=version, chunks=chunks)


def _glb_scene_mesh_order(path: Path) -> list[str]:
    """Return mesh node names in glTF scene-children order (same as Three.js)."""
    try:
        data = Path(path).read_bytes()
    except OSError:
        return []
    if len(data) < 20 or data[:4] != b"glTF":
        return []
    try:
        offset = 12
        payload = None
        while offset + 8 <= len(data):
            length, ctype = struct.unpack_from("<I4s", data, offset)
            offset += 8
            chunk = data[offset : offset + length]
            offset += length
            if ctype == b"JSON":
                payload = json.loads(chunk.decode("utf-8"))
                break
        if not isinstance(payload, dict):
            return []
        nodes = payload.get("nodes") or []
        scenes = payload.get("scenes") or []
        if not nodes or not scenes:
            return []
        scene_index = int(payload.get("scene") or 0)
        scene = scenes[scene_index] if 0 <= scene_index < len(scenes) else scenes[0]
        order: list[str] = []

        def walk(idx: int) -> None:
            if idx is None or idx < 0 or idx >= len(nodes):
                return
            node = nodes[idx] or {}
            if "mesh" in node:
                order.append(str(node.get("name") or f"node_{idx}"))
            for child in node.get("children") or []:
                try:
                    walk(int(child))
                except (TypeError, ValueError):
                    continue

        for root in scene.get("nodes") or []:
            try:
                walk(int(root))
            except (TypeError, ValueError):
                continue
        return order
    except Exception:
        logger.debug("Could not parse glTF mesh order from %s", path, exc_info=True)
        return []


def _normalize_body_key(value: str | None) -> str:
    return re.sub(r"[\s_]+", " ", str(value or "").strip().lower())


def _order_entries_like_gltf(
    entries: list[tuple[str, str, Any, np.ndarray]],
    gltf_order: list[str],
) -> list[tuple[str, str, Any, np.ndarray]]:
    if not entries:
        return entries
    if not gltf_order:
        # Fall back: trimesh often reverses glTF children — flip to match Three.js.
        return list(reversed(entries))
    by_key: dict[str, list[tuple[str, str, Any, np.ndarray]]] = {}
    for entry in entries:
        key = _normalize_body_key(entry[0]) or _normalize_body_key(entry[1])
        by_key.setdefault(key, []).append(entry)
    ordered: list[tuple[str, str, Any, np.ndarray]] = []
    used: set[int] = set()
    for name in gltf_order:
        key = _normalize_body_key(name)
        bucket = by_key.get(key) or []
        while bucket:
            entry = bucket.pop(0)
            ordered.append(entry)
            used.add(id(entry))
            break
    for entry in entries:
        if id(entry) not in used:
            ordered.append(entry)
    return ordered


def _scene_geometry_entries(
    scene: trimesh.Scene,
    *,
    source_path: Path | None = None,
) -> list[tuple[str, str, Any, np.ndarray]]:
    """Return ``(node_name, geom_name, geom, world_transform)`` in Three.js order."""
    entries: list[tuple[str, str, Any, np.ndarray]] = []
    for node_name in scene.graph.nodes_geometry:
        transform, geom_name = scene.graph.get(node_name)
        geom = scene.geometry.get(geom_name)
        if geom is None:
            continue
        world = np.asarray(transform, dtype=float) if transform is not None else np.eye(4)
        entries.append((str(node_name), str(geom_name), geom, world))
    gltf_order = _glb_scene_mesh_order(source_path) if source_path else []
    return _order_entries_like_gltf(entries, gltf_order)


def _resolve_scene_body_entry(
    entries: list[tuple[str, str, Any, np.ndarray]],
    body_index: int,
    body_name: str | None = None,
) -> tuple[int, tuple[str, str, Any, np.ndarray]]:
    if body_name:
        want = _normalize_body_key(body_name)
        # Exact / normalized name match only — never fall through to a wrong index
        # when the client sent a real body name (Fusion multi-body).
        for i, entry in enumerate(entries):
            node_name, geom_name, _geom, _world = entry
            if _normalize_body_key(node_name) == want or _normalize_body_key(geom_name) == want:
                return i, entry
        raise ValueError(f"body_name not found: {body_name}")
    idx = int(body_index)
    if idx < 0 or idx >= len(entries):
        raise ValueError(f"body_index out of range: {idx}")
    return idx, entries[idx]


def _unique_trimesh_copy(geom: Any) -> Any:
    """Deep-copy a trimesh so sibling nodes that share vertex arrays stay independent."""
    cloned = geom.copy()
    try:
        cloned.vertices = np.array(cloned.vertices, dtype=np.float64, copy=True)
    except Exception:
        pass
    try:
        if getattr(cloned, "faces", None) is not None:
            cloned.faces = np.array(cloned.faces, copy=True)
    except Exception:
        pass
    return cloned


def _export_scene_entries(entries: list[tuple[str, str, Any, np.ndarray]], path: Path) -> Path:
    """Write a multi-mesh GLB from geometry entries, preserving materials.

    Entries are expected in Three.js / glTF children order. We write in that same
    order so the viewer keeps stable body indices; ``_scene_geometry_entries``
    compensates for trimesh's reversed load order on the next read.
    """
    rebuilt = trimesh.Scene()
    used_geom: set[str] = set()
    for node_name, geom_name, geom, world in entries:
        gname = geom_name or node_name or "part"
        if gname in used_geom:
            gname = f"{gname}_{len(used_geom)}"
        used_geom.add(gname)
        cloned = _unique_trimesh_copy(geom)
        # Bake any non-identity node transform into vertices so reload order is irrelevant.
        if world is not None and not np.allclose(world, np.eye(4)):
            cloned.apply_transform(world)
        rebuilt.add_geometry(cloned, geom_name=gname, node_name=node_name or gname)
    return export_scene(rebuilt, path)


def apply_transform_preserving_parts(
    path: Path,
    transform: dict[str, Any],
    *,
    out_path: Path | None = None,
) -> Path:
    """Apply a transform while keeping multi-mesh GLB materials and parts intact."""
    path = Path(path)
    dest = Path(out_path) if out_path is not None else path
    scene = load_scene(path)
    entries = _scene_geometry_entries(scene, source_path=path)
    centers = []
    for _node, _gname, geom, world in entries:
        try:
            bounds = np.asarray(geom.bounds, dtype=float)
            local_center = bounds.mean(axis=0)
            center_h = np.array([local_center[0], local_center[1], local_center[2], 1.0], dtype=float)
            centers.append((world @ center_h)[:3])
        except Exception:
            centers.append(np.zeros(3, dtype=float))
    center = np.mean(np.asarray(centers, dtype=float), axis=0) if centers else np.zeros(3)
    matrix = _compose_pivot_matrix(transform, center)
    if path.suffix.lower() == ".glb":
        return _patch_glb_scene_transform(path, dest, matrix)
    if len(entries) <= 1:
        mesh = load_mesh(path)
        export_mesh(apply_transform(mesh, transform), dest)
        return dest
    updated: list[tuple[str, str, Any, np.ndarray]] = []
    for node_name, geom_name, geom, world in entries:
        cloned = _unique_trimesh_copy(geom)
        # world' = matrix @ world, bake into vertices with identity node xform
        cloned.apply_transform(matrix @ world)
        updated.append((node_name, geom_name, cloned, np.eye(4)))
    return _export_scene_entries(updated, dest)


PLACEMENTS_FILENAME = "r3d_placements.json"


def apply_project_placements(project_path: Path) -> list[dict[str, Any]]:
    """Apply any harness `r3d_placements.json` moves to existing project files."""
    root = Path(project_path)
    spec_path = root / PLACEMENTS_FILENAME
    if not spec_path.is_file():
        return []
    try:
        spec = json.loads(spec_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    moves = spec.get("moves") if isinstance(spec, dict) else spec
    if not isinstance(moves, list):
        return []
    applied: list[dict[str, Any]] = []
    for raw in moves[:40]:
        if not isinstance(raw, dict):
            continue
        name = Path(str(raw.get("filename") or raw.get("file") or "")).name
        if not name:
            continue
        src = root / name
        if not src.is_file():
            continue
        viewer_name = viewer_filename_for_model(name, root)
        viewer_path = root / viewer_name
        transform_src = viewer_path if viewer_path.is_file() else src
        transform: dict[str, Any] = {}
        if raw.get("translation") is not None:
            transform["translation"] = raw["translation"]
        if raw.get("rotation_deg") is not None:
            transform["rotation_deg"] = raw["rotation_deg"]
        if raw.get("scale") is not None:
            transform["scale"] = raw["scale"]
        if not transform:
            continue
        stem = transform_src.stem.replace("_edited", "") + "_edited"
        out = root / f"{stem}.glb"
        try:
            apply_transform_preserving_parts(transform_src, transform, out_path=out)
            applied.append({"filename": name, "out": out.name, **transform})
        except Exception as exc:
            logger.warning("Could not apply placement for %s: %s", name, exc)
    try:
        spec_path.unlink()
    except OSError:
        pass
    return applied


def transform_scene_body(
    path: Path,
    body_index: int,
    transform: dict[str, Any],
    *,
    out_path: Path | None = None,
    body_name: str | None = None,
) -> Path:
    """Transform one body in-place on its mesh so other parts and materials stay put."""
    path = Path(path)
    dest = Path(out_path) if out_path is not None else path
    scene = load_scene(path)
    entries = _scene_geometry_entries(scene, source_path=path)
    _idx, (node_name, geom_name, geom, world) = _resolve_scene_body_entry(entries, body_index, body_name)
    try:
        bounds = np.asarray(geom.bounds, dtype=float)
        local_center = bounds.mean(axis=0)
        center_h = np.array([local_center[0], local_center[1], local_center[2], 1.0], dtype=float)
        center = (world @ center_h)[:3]
    except Exception:
        center = np.zeros(3, dtype=float)
    matrix = _compose_pivot_matrix(transform, center)
    if path.suffix.lower() == ".glb":
        return _patch_glb_scene_transform(
            path,
            dest,
            matrix,
            body_index=body_index,
            body_name=body_name,
        )
    if len(entries) <= 1:
        mesh = load_mesh(path)
        export_mesh(transform_mesh_body(mesh, int(body_index), transform), dest)
        return dest
    updated: list[tuple[str, str, Any, np.ndarray]] = []
    for n_name, g_name, g_geom, g_world in entries:
        cloned = _unique_trimesh_copy(g_geom)
        if n_name == node_name and g_name == geom_name:
            cloned.apply_transform(matrix @ g_world)
        elif not np.allclose(g_world, np.eye(4)):
            cloned.apply_transform(g_world)
        updated.append((n_name, g_name, cloned, np.eye(4)))
    return _export_scene_entries(updated, dest)


def face_pull_scene_body(
    path: Path,
    face_indices: list[int],
    *,
    body_index: int | None = None,
    body_name: str | None = None,
    distance: float,
    op: str = "auto",
    direction: str = "one",
    distance2: float = 0.0,
    taper_deg: float = 0.0,
    through: bool = False,
    normal: list[float] | None = None,
    out_path: Path | None = None,
) -> Path:
    """Press-pull one body inside a multi-mesh assembly without flattening the rest."""
    path = Path(path)
    dest = Path(out_path) if out_path is not None else path
    if path.suffix.lower() == ".glb":
        # Face pull rewrites mesh topology through Trimesh. It cannot currently
        # round-trip authored scene structure such as animation targets, pivots,
        # instances, skins, extras, or advanced materials. Reject those scenes
        # before writing instead of returning a visually plausible but dead GLB.
        reasons = [
            reason
            for reason in _glb_scene_structure_reasons(path)
            if reason != "multiple named or instanced parts"
        ]
        if reasons:
            detail = ", ".join(dict.fromkeys(reasons))
            raise ValueError(
                f"Face pull cannot safely edit this structured scene ({detail}). "
                "Export or select one standalone mesh body first."
            )
    scene = load_scene(path)
    entries = _scene_geometry_entries(scene, source_path=path)

    # Single-body edits can fall back to kernel B-rep when mesh engines fail.
    brep: Path | None = None
    if len(entries) <= 1:
        resolved = resolve_native_brep_step(path.parent, path.name)
        if resolved is not None and is_editable_brep_step(resolved):
            brep = resolved
        elif path.suffix.lower() in STEP_SUFFIXES and is_editable_brep_step(path):
            brep = path
    token = _BOOLEAN_BREP_BASE.set(brep)
    try:
        return _face_pull_scene_body_impl(
            path,
            face_indices,
            entries=entries,
            body_index=body_index,
            body_name=body_name,
            distance=distance,
            op=op,
            direction=direction,
            distance2=distance2,
            taper_deg=taper_deg,
            through=through,
            normal=normal,
            dest=dest,
        )
    finally:
        _BOOLEAN_BREP_BASE.reset(token)


def _face_pull_scene_body_impl(
    path: Path,
    face_indices: list[int],
    *,
    entries: list,
    body_index: int | None,
    body_name: str | None,
    distance: float,
    op: str,
    direction: str,
    distance2: float,
    taper_deg: float,
    through: bool,
    normal: list[float] | None,
    dest: Path,
) -> Path:
    if len(entries) <= 1:
        mesh = load_mesh(path)
        result = face_pull_many(
            mesh,
            face_indices,
            distance=distance,
            op=op,
            direction=direction,
            distance2=distance2,
            taper_deg=taper_deg,
            through=through,
            normal=normal,
        )
        export_mesh(result, dest)
        return dest

    # Local face indices on the named/indexed body (Fusion multi-body shells).
    if body_name is not None or body_index is not None:
        idx, (node_name, geom_name, geom, world) = _resolve_scene_body_entry(
            entries,
            int(body_index or 0),
            body_name,
        )
        local_faces = sorted({int(i) for i in face_indices if int(i) >= 0})
        working = geom.copy()
        if not np.allclose(world, np.eye(4)):
            working.apply_transform(world)
        pulled = face_pull_many(
            working,
            local_faces,
            distance=distance,
            op=op,
            direction=direction,
            distance2=distance2,
            taper_deg=taper_deg,
            through=through,
            normal=normal,
        )
        updated: list[tuple[str, str, Any, np.ndarray]] = []
        for i, (n_name, g_name, g_geom, g_world) in enumerate(entries):
            if i == idx:
                updated.append((node_name, geom_name, pulled, np.eye(4)))
                continue
            cloned = g_geom.copy()
            if not np.allclose(g_world, np.eye(4)):
                cloned.apply_transform(g_world)
            updated.append((n_name, g_name, cloned, np.eye(4)))
        return _export_scene_entries(updated, dest)

    # Legacy global face indices across concatenated bodies.
    offsets: list[int] = []
    off = 0
    for _n, _g, geom, _w in entries:
        offsets.append(off)
        off += int(len(np.asarray(geom.faces)))
    by_body: dict[int, list[int]] = {}
    for fi in face_indices:
        fi = int(fi)
        body_i = 0
        for i in range(len(offsets) - 1, -1, -1):
            if fi >= offsets[i]:
                body_i = i
                break
        by_body.setdefault(body_i, []).append(fi - offsets[body_i])
    updated = []
    for i, (n_name, g_name, g_geom, g_world) in enumerate(entries):
        cloned = g_geom.copy()
        if not np.allclose(g_world, np.eye(4)):
            cloned.apply_transform(g_world)
        if i in by_body:
            cloned = face_pull_many(
                cloned,
                by_body[i],
                distance=distance,
                op=op,
                direction=direction,
                distance2=distance2,
                taper_deg=taper_deg,
                through=through,
                normal=normal,
            )
        updated.append((n_name, g_name, cloned, np.eye(4)))
    return _export_scene_entries(updated, dest)


def export_step_as_single_part(step_path: Path, dest_path: Path | None = None) -> Path:
    """Rewrite a multi-component assembly STEP as one Fusion Part document.

    Fusion treats product/assembly hierarchies (NEXT_ASSEMBLY_USAGE) as assemblies.
    This loads the geometry, packs solids under one shape label (no assembly tree),
    and writes a single-product STEP so Fusion opens a Part — optionally with
    multiple Bodies if solids do not fuse cleanly.
    """
    from OCP.BRep import BRep_Builder
    from OCP.IFSelect import IFSelect_ReturnStatus
    from OCP.STEPControl import STEPControl_Reader, STEPControl_StepModelType
    from OCP.TopAbs import TopAbs_SOLID
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS_Compound

    step_path = Path(step_path)
    dest = Path(dest_path) if dest_path else step_path.with_name(f"{step_path.stem}.part{step_path.suffix}")
    reader = STEPControl_Reader()
    status = reader.ReadFile(str(step_path))
    if status != IFSelect_ReturnStatus.IFSelect_RetDone:
        raise ValueError(f"Could not read STEP file: {step_path.name}")
    reader.TransferRoots()
    shape = reader.OneShape()
    if shape.IsNull():
        raise ValueError(f"STEP file has no geometry: {step_path.name}")

    solids = []
    exp = TopExp_Explorer(shape, TopAbs_SOLID)
    while exp.More():
        solids.append(exp.Current())
        exp.Next()

    if len(solids) <= 1:
        out_shape = solids[0] if solids else shape
    else:
        # Pack solids into one compound — Fusion opens this as one Part with Bodies,
        # not an assembly of components. (Geometric fuse is optional and often fails
        # on interlocking mechanism parts.)
        builder = BRep_Builder()
        compound = TopoDS_Compound()
        builder.MakeCompound(compound)
        for solid in solids:
            builder.Add(compound, solid)
        out_shape = compound

    from OCP.STEPCAFControl import STEPCAFControl_Writer
    from OCP.TCollection import TCollection_ExtendedString
    from OCP.TDataStd import TDataStd_Name
    from OCP.TDocStd import TDocStd_Document
    from OCP.XCAFApp import XCAFApp_Application
    from OCP.XCAFDoc import XCAFDoc_DocumentTool

    app = XCAFApp_Application.GetApplication_s()
    fmt = TCollection_ExtendedString("BinXCAF")
    doc = TDocStd_Document(fmt)
    app.NewDocument(fmt, doc)
    shape_tool = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
    # makeAssembly=False keeps one free shape / one product — Fusion Part, not Assembly.
    label = shape_tool.AddShape(out_shape, False)
    part_label = sanitize_fusion_part_stem(step_path.stem)
    # Avoid leaving "Assembly" in the STEP product name — Fusion mirrors that into
    # the browser and users Insert it as a linked component.
    try:
        TDataStd_Name.Set_s(label, TCollection_ExtendedString(part_label[:120]))
    except Exception:
        try:
            TDataStd_Name.Set(label, TCollection_ExtendedString(part_label[:120]))
        except Exception:
            pass
    writer = STEPCAFControl_Writer()
    try:
        writer.SetNameMode(True)
    except Exception:
        pass
    writer.Transfer(doc, STEPControl_StepModelType.STEPControl_AsIs)
    write_status = writer.Write(str(dest))
    if write_status != IFSelect_ReturnStatus.IFSelect_RetDone:
        # Plain writer fallback (still better than the original assembly STEP).
        from OCP.STEPControl import STEPControl_Writer

        plain = STEPControl_Writer()
        plain.Transfer(out_shape, STEPControl_StepModelType.STEPControl_AsIs)
        write_status = plain.Write(str(dest))
        if write_status != IFSelect_ReturnStatus.IFSelect_RetDone:
            raise ValueError(f"Could not write part STEP: {dest.name}")
    # Refuse to hand Fusion a still-linked STEP (Cut → "No target body found…").
    if step_has_assembly_links(dest):
        raise ValueError(
            f"Part STEP {dest.name} still has assembly links after flatten — refusing Fusion upload."
        )
    if not is_editable_brep_step(dest):
        raise ValueError(
            f"Part STEP {dest.name} is not editable B-rep — Extrude/Cut would fail in Fusion."
        )
    return dest


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
            doc = TDocStd_Document(TCollection_ExtendedString("Render Studio"))
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
            names = zf.namelist()
            if "3D/3dmodel.model" not in names:
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
            # Multi-body files without Bambu plate metadata need a multi-plate rewrite.
            objs = root.findall(f".//{{{THREEMF_CORE_NS}}}object[@type='model']")
            mesh_objs = [o for o in objs if o.find(f"{{{THREEMF_CORE_NS}}}mesh") is not None]
            if len(items) > 1 or len(mesh_objs) > 1:
                if "Metadata/model_settings.config" not in names:
                    return True
                settings = zf.read("Metadata/model_settings.config").decode("utf-8", errors="replace")
                if settings.count("<plate>") < 2 and (len(items) > 1 or len(mesh_objs) > 1):
                    return True
            # Geometry may live only in Objects/*.model for Bambu packages.
            tris = root.findall(f".//{{{THREEMF_CORE_NS}}}triangle")
            if not tris:
                has_object_models = any(n.startswith("3D/Objects/") and n.endswith(".model") for n in names)
                if not has_object_models:
                    return True
            else:
                first = tris[0]
                if first.get("p2") is not None or first.get("p3") is not None:
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


def ensure_mesh_exports(
    project_path: Path,
    filename: str,
    *,
    missing_only: bool = False,
    visible_body_indices: list[int] | None = None,
) -> None:
    """Generate STL / 3MF / faceted-STEP siblings for a mesh model when missing or stale.

    Native B-rep `{stem}.step` from text-to-cad is never overwritten. Mesh→STEP
    always lands in `{stem}__faceted.step` so Fusion push can keep using solid STEP.

    ``visible_body_indices`` only affects 3MF (print plates for unhidden bodies).
    """
    src = _mesh_geometry_source(project_path, filename)
    if src is None or not src.is_file():
        src = derived_export_source(project_path, filename)
    if src is None or not src.is_file():
        return
    if src.suffix.lower() not in SUPPORTED_IMPORT:
        return

    out_dir = src.parent
    safe = src.name
    stem = src.stem
    src_mtime = src.stat().st_mtime
    mesh: trimesh.Trimesh | None = None
    scene: trimesh.Scene | None = None
    src_is_step = src.suffix.lower() in STEP_SUFFIXES
    force_3mf = visible_body_indices is not None

    for fmt in MESH_DERIVED_EXPORTS:
        if fmt == "step" and src_is_step:
            continue
        if fmt == "step":
            dest = out_dir / faceted_step_name(stem)
            native = out_dir / f"{stem}.step"
            if not native.is_file():
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
            dest = out_dir / f"{stem}.{fmt}"

        if fmt == "3mf" and force_3mf:
            pass  # always rebuild filtered print plates
        elif missing_only and dest.is_file() and not _export_is_stale(src_mtime, dest, fmt):
            continue
        elif not missing_only and dest.is_file() and not _export_is_stale(src_mtime, dest, fmt):
            continue
        try:
            if fmt == "3mf":
                convert_mesh_to_3mf(
                    project_path,
                    filename,
                    dest=dest,
                    visible_body_indices=visible_body_indices,
                )
            elif fmt == "obj":
                if scene is None:
                    scene = load_scene(src)
                export_scene(scene, dest)
            else:
                if mesh is None:
                    mesh = load_mesh(src)
                if fmt == "step":
                    export_mesh_step(mesh, dest)
                else:
                    export_mesh(mesh, dest)
            logger.info("Generated %s export for %s", fmt.upper(), safe)
        except Exception as exc:
            logger.warning("Could not generate %s for %s: %s", fmt, safe, exc)
            if fmt == "3mf" and force_3mf:
                raise


def _snapshot_face_colors(mesh: trimesh.Trimesh) -> np.ndarray | None:
    try:
        fc = getattr(mesh.visual, "face_colors", None)
        if fc is not None and len(fc) == len(mesh.faces):
            return np.asarray(fc, dtype=np.uint8).copy()
    except Exception:
        pass
    try:
        vc = getattr(mesh.visual, "vertex_colors", None)
        n_verts = _mesh_len(mesh, "vertices")
        n_faces = _mesh_len(mesh, "faces")
        if vc is not None and n_verts and n_faces and len(vc) == n_verts:
            faces = np.asarray(mesh.faces, dtype=int)
            if faces.size == 0 or int(faces.max()) >= n_verts:
                return None
            vc = np.asarray(vc, dtype=np.uint8)
            return vc[faces].mean(axis=1).astype(np.uint8)
    except Exception:
        pass
    try:
        material = getattr(mesh.visual, "material", None)
        color = getattr(material, "main_color", None)
        if color is None:
            color = getattr(material, "diffuse", None)
        if color is None:
            color = getattr(material, "baseColorFactor", None)
        if color is not None and len(mesh.faces):
            arr = np.asarray(color, dtype=np.float64).reshape(-1)
            if arr.size >= 3:
                if float(arr.max()) <= 1.5:
                    arr = arr * 255.0
                rgba = np.array(
                    [
                        int(round(min(255.0, max(0.0, float(arr[0]))))),
                        int(round(min(255.0, max(0.0, float(arr[1]))))),
                        int(round(min(255.0, max(0.0, float(arr[2]))))),
                        int(round(min(255.0, max(0.0, float(arr[3] if arr.size > 3 else 255.0))))),
                    ],
                    dtype=np.uint8,
                )
                return np.tile(rgba, (len(mesh.faces), 1))
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
        avg = float(mean.mean())
        # Mid greys (cadpy / OCC) plus glTF default white — not authored shop metals.
        defaultish = 90.0 <= avg <= 220.0 or (greyish and avg >= 230.0)
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


def _mesh_to_ocp_shape(mesh: trimesh.Trimesh):
    """Convert a triangle mesh to a closed OpenCascade solid via temporary STL.

    Raw STL import yields a face compound (2D). Sew + MakeSolid so build123d/OCP
    booleans can subtract it from a real B-rep solid.
    """
    import tempfile

    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeSolid, BRepBuilderAPI_Sewing
    from OCP.StlAPI import StlAPI_Reader
    from OCP.TopAbs import TopAbs_SHELL, TopAbs_SOLID
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS, TopoDS_Shape

    with tempfile.NamedTemporaryFile(suffix=".stl", delete=False) as tmp:
        tmp_path = Path(tmp.name)
    try:
        export_mesh(mesh, tmp_path)
        reader = StlAPI_Reader()
        shape = TopoDS_Shape()
        if not reader.Read(shape, str(tmp_path)):
            raise ValueError("Could not convert mesh to B-rep shape")
        if shape.IsNull():
            raise ValueError("Converted B-rep shape is empty")

        # Already a solid — use as-is.
        solids = []
        exp = TopExp_Explorer(shape, TopAbs_SOLID)
        while exp.More():
            solids.append(exp.Current())
            exp.Next()
        if len(solids) == 1:
            return solids[0]
        if len(solids) > 1:
            return shape

        sewer = BRepBuilderAPI_Sewing(1.0e-3)
        sewer.Add(shape)
        sewer.Perform()
        sewn = sewer.SewedShape()
        if sewn.IsNull():
            raise ValueError("Could not sew mesh faces into a shell")

        def _as_shell(s):
            if hasattr(TopoDS, "Shell_s"):
                return TopoDS.Shell_s(s)
            return TopoDS.Shell(s)

        maker = BRepBuilderAPI_MakeSolid()
        shell_count = 0
        exp = TopExp_Explorer(sewn, TopAbs_SHELL)
        while exp.More():
            maker.Add(_as_shell(exp.Current()))
            shell_count += 1
            exp.Next()
        if shell_count == 0 and int(sewn.ShapeType()) == int(TopAbs_SHELL):
            maker.Add(_as_shell(sewn))
            shell_count = 1
        if shell_count == 0 or not maker.IsDone():
            raise ValueError("Could not build a solid from sewn mesh shell")
        solid = maker.Solid()
        if solid.IsNull():
            raise ValueError("Sewn mesh solid is empty")
        return solid
    finally:
        tmp_path.unlink(missing_ok=True)


def _resolve_boolean_brep_base(
    mesh: trimesh.Trimesh | None = None,
    *,
    brep_base: Path | None = None,
) -> Path | None:
    """Pick an editable STEP sibling for kernel-style boolean fallback."""
    candidates: list[Path] = []
    if brep_base is not None:
        candidates.append(Path(brep_base))
    ctx = _BOOLEAN_BREP_BASE.get()
    if ctx is not None:
        candidates.append(Path(ctx))
    meta = getattr(mesh, "metadata", None) if mesh is not None else None
    if isinstance(meta, dict):
        for key in ("brep_step", "source_step", "step_path"):
            raw = meta.get(key)
            if raw:
                candidates.append(Path(str(raw)))
    for cand in candidates:
        try:
            if cand.is_file() and is_editable_brep_step(cand):
                return cand
        except Exception:
            continue
    return None


def _boolean_via_brep(base_step: Path, cutter_mesh: trimesh.Trimesh, op: str) -> trimesh.Trimesh:
    """Kernel-style B-rep boolean (build123d/OCP base ∓ cutter), then tessellate."""
    base_step = Path(base_step)
    cutter = _ensure_positive_volume(cutter_mesh)
    cutter_ocp = _mesh_to_ocp_shape(cutter)

    # Prefer build123d operators (same path as the feature kernel).
    try:
        from build123d import Solid, import_step

        base = import_step(str(base_step))
        try:
            cutter_shape = Solid(cutter_ocp)
        except Exception:
            from build123d import Shape

            cutter_shape = Shape.cast(cutter_ocp)
        if op == "difference":
            result = base - cutter_shape
        elif op == "union":
            result = base + cutter_shape
        elif op == "intersection":
            result = base & cutter_shape
        else:
            raise ValueError(f"Unknown boolean op: {op}")
        if result is None:
            return _empty_mesh()
        wrapped = getattr(result, "wrapped", None)
        if wrapped is None or getattr(wrapped, "IsNull", lambda: True)():
            return _empty_mesh()
        return repair_mesh(_tessellate_shape_to_mesh(wrapped))
    except Exception as exc:
        logger.info("build123d boolean fallback failed (%s); trying OCP BRepAlgoAPI", exc)

    from OCP.BRepAlgoAPI import BRepAlgoAPI_Common, BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
    from OCP.IFSelect import IFSelect_ReturnStatus
    from OCP.STEPControl import STEPControl_Reader

    reader = STEPControl_Reader()
    status = reader.ReadFile(str(base_step))
    if status != IFSelect_ReturnStatus.IFSelect_RetDone:
        raise ValueError(f"Could not read STEP for boolean fallback: {base_step.name}")
    reader.TransferRoots()
    base_shape = reader.OneShape()
    if base_shape.IsNull():
        raise ValueError(f"STEP has no geometry for boolean fallback: {base_step.name}")
    if op == "difference":
        algo = BRepAlgoAPI_Cut(base_shape, cutter_ocp)
    elif op == "union":
        algo = BRepAlgoAPI_Fuse(base_shape, cutter_ocp)
    elif op == "intersection":
        algo = BRepAlgoAPI_Common(base_shape, cutter_ocp)
    else:
        raise ValueError(f"Unknown boolean op: {op}")
    algo.Build()
    if not algo.IsDone():
        raise ValueError(f"OCP boolean {op} failed on {base_step.name}")
    out_shape = algo.Shape()
    if out_shape.IsNull():
        return _empty_mesh()
    return repair_mesh(_tessellate_shape_to_mesh(out_shape))


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


def _boolean(
    mesh_a: trimesh.Trimesh,
    mesh_b: trimesh.Trimesh,
    op: str,
    *,
    brep_base: Path | None = None,
) -> trimesh.Trimesh:
    """Boolean CSG with repair. Difference never falls back to deleting triangles.

    When mesh engines fail and an editable STEP sibling is available (explicit
    ``brep_base``, context, or mesh metadata), fall back to build123d/OCP
    kernel-style ``base ∓ cutter`` and tessellate the result.
    """
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
        step = _resolve_boolean_brep_base(a, brep_base=brep_base)
        if step is not None:
            try:
                logger.info(
                    "Boolean difference falling back to B-rep via %s",
                    step.name,
                )
                out = _boolean_via_brep(step, b, "difference")
                score = _difference_result_quality(a, out)
                if score >= 0 or len(getattr(out, "vertices", [])) == 0:
                    return out
                last_err = ValueError(
                    f"B-rep fallback produced no material removal (score={score})"
                )
            except Exception as exc:
                last_err = exc
                logger.info("Boolean B-rep fallback failed: %s", exc)
        raise ValueError(
            f"Boolean cut failed{f': {last_err}' if last_err else ''}. "
            "Try a shallower depth, re-pick the face, or repair the mesh."
        )

    step = _resolve_boolean_brep_base(a, brep_base=brep_base)
    if step is not None:
        try:
            logger.info("Boolean %s falling back to B-rep via %s", op, step.name)
            return _boolean_via_brep(step, b, op)
        except Exception as exc:
            last_err = exc
            logger.info("Boolean B-rep fallback failed: %s", exc)

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
        "black": [126, 144, 168, 255],  # slate (visible on dark canvas — never true black)
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
    n = _mesh_len(mesh, "faces")
    if n < 1:
        empty = np.zeros((0, 4), dtype=np.uint8)
        try:
            mesh.visual.face_colors = empty
        except Exception:
            pass
        return empty
    if mesh.visual.face_colors is None or len(mesh.visual.face_colors) != n:
        base = default
        if base is None:
            snap = _snapshot_face_colors(mesh)
            if snap is not None and len(snap) == n:
                mesh.visual.face_colors = snap
                return mesh.visual.face_colors
            base = np.array([196, 196, 196, 255], dtype=np.uint8)
        mesh.visual.face_colors = np.tile(base, (n, 1))
    return mesh.visual.face_colors


def paint_faces(mesh: trimesh.Trimesh, face_indices: list[int], color: Any) -> trimesh.Trimesh:
    m = mesh_copy(mesh)
    if len(m.faces) < 1:
        raise ValueError("This body has no faces to color.")
    rgba = _parse_color(color)
    colors = _ensure_face_colors(m)
    for fi in face_indices:
        if 0 <= fi < len(m.faces):
            colors[fi] = rgba
    m.visual.face_colors = colors
    return m


def set_mesh_material(mesh: trimesh.Trimesh, color: Any) -> trimesh.Trimesh:
    m = mesh_copy(mesh)
    if len(m.faces) < 1 or len(m.vertices) < 1:
        raise ValueError("This body has no faces to color.")
    rgba = _parse_color(color)
    m.visual.face_colors = np.tile(rgba, (len(m.faces), 1))
    try:
        return _mesh_with_cad_pbr(m, rgba, name=str(getattr(m, "metadata", {}).get("name") or ""))
    except Exception:
        return m


def _geom_has_faces(geom: Any) -> bool:
    try:
        return isinstance(geom, trimesh.Trimesh) and _mesh_len(geom, "faces") > 0 and _mesh_len(geom, "vertices") > 0
    except Exception:
        return False


def paintable_mesh_path(project_path: Path, src: Path) -> Path:
    """Viewer GLB for coloring, tessellating STEP when the sibling mesh is empty."""
    from backend.services.engine_layout import project_rel, resolve_in_layout

    project_path = Path(project_path)
    src = Path(src)
    hint = project_rel(project_path, src) if src.is_file() else src.name
    viewer_name = viewer_filename_for_model(hint, project_path)
    viewer = resolve_in_layout(project_path, viewer_name)
    if viewer is None:
        candidate = project_path / str(viewer_name or "")
        viewer = candidate if candidate.is_file() else None

    def _usable(path: Path | None) -> Path | None:
        if path is None or not path.is_file():
            return None
        if path.suffix.lower() not in {".glb", ".gltf", ".stl", ".obj", ".ply", ".off"}:
            return None
        try:
            scene = load_scene(path)
            if any(_geom_has_faces(g) for g in scene.geometry.values()):
                return path
        except Exception:
            pass
        try:
            mesh = load_mesh(path)
            if _geom_has_faces(mesh):
                return path
        except Exception:
            return None
        return None

    found = _usable(viewer)
    if found is not None:
        return found

    def _rebuild_from_step(step: Path, dest: Path) -> Path | None:
        if dest.is_file() and _usable(dest) is None:
            try:
                dest.unlink()
            except OSError:
                pass
        tessellate_step_to_glb(step, dest)
        return _usable(dest)

    if src.suffix.lower() in STEP_SUFFIXES:
        dest = src.with_suffix(".glb")
        usable = _rebuild_from_step(src, dest)
        if usable is not None:
            return usable
        raise ValueError(f"Could not tessellate {src.name} into a mesh to color.")
    if _usable(src) is not None:
        return src
    if src.suffix.lower() in {".glb", ".gltf"}:
        for ext in STEP_SUFFIXES:
            sibling = src.with_suffix(ext)
            if sibling.is_file():
                usable = _rebuild_from_step(sibling, src.with_suffix(".glb"))
                if usable is not None:
                    return usable
                break
    raise ValueError(f"No mesh geometry to color on {src.name}.")


def paint_model_appearance(
    path: Path,
    *,
    color: Any,
    scope: str = "object",
    body_index: int | None = None,
    body_name: str | None = None,
    face_indices: list[int] | None = None,
    out_path: Path | None = None,
) -> Path:
    """Color a model like FreeCAD Shape Appearance.

    ``scope=object`` sets ShapeColor on the selected solid (or every solid when
    no body is specified). ``scope=faces`` sets DiffuseColor on picked triangles
    of that solid.
    """
    path = Path(path)
    dest = Path(out_path) if out_path is not None else path
    scope_l = str(scope or "object").strip().lower()
    indices = [int(i) for i in (face_indices or []) if int(i) >= 0]
    target_body = bool(body_name) or body_index is not None

    def _paint_faces_geom(geom: Any, local_indices: list[int]) -> Any:
        painted = paint_faces(geom, local_indices, color)
        painted = _explode_keep_face_colors(painted)
        return _bake_face_colors_to_vertices(painted)

    def _resolve_paint_entry(
        entries: list[tuple[str, str, Any, np.ndarray]],
        paintable: list[tuple[int, tuple[str, str, Any, np.ndarray]]],
    ) -> tuple[int, tuple[str, str, Any, np.ndarray]]:
        if body_name:
            try:
                idx, entry = _resolve_scene_body_entry(entries, int(body_index or 0), body_name)
                if _geom_has_faces(entry[2]):
                    return idx, entry
            except ValueError:
                pass
        if body_index is not None:
            idx = int(body_index)
            if 0 <= idx < len(entries) and _geom_has_faces(entries[idx][2]):
                return idx, entries[idx]
            if 0 <= idx < len(paintable):
                return paintable[idx]
            raise ValueError(f"body_index out of range: {idx}")
        raise ValueError("Select a body before coloring a single solid.")

    if path.suffix.lower() == ".glb" and scope_l == "object":
        return _patch_glb_material_color(
            path,
            dest,
            color,
            body_index=body_index if target_body else None,
            body_name=body_name if target_body else None,
        )

    if path.suffix.lower() == ".glb" and scope_l == "faces":
        reasons = [
            reason
            for reason in _glb_scene_structure_reasons(path)
            if reason != "multiple named or instanced parts"
        ]
        if reasons:
            raise ValueError(
                "Face painting cannot safely rewrite this structured GLB "
                f"({', '.join(dict.fromkeys(reasons))}). Paint a whole body or export one standalone mesh first."
            )

    if path.suffix.lower() in {".glb", ".gltf", ".obj"}:
        scene = load_scene(path)
        entries = _scene_geometry_entries(scene, source_path=path)
        paintable = [(i, e) for i, e in enumerate(entries) if _geom_has_faces(e[2])]
        if not paintable:
            raise ValueError("This model has no mesh bodies to color.")

        if scope_l == "object":
            if target_body:
                idx, (node, gname, geom, world) = _resolve_paint_entry(entries, paintable)
                if not _geom_has_faces(geom):
                    raise ValueError("Selected body has no faces to color.")
                entries[idx] = (node, gname, set_mesh_material(geom, color), world)
            else:
                updated: list[tuple[str, str, Any, np.ndarray]] = []
                for node, gname, geom, world in entries:
                    if _geom_has_faces(geom):
                        geom = set_mesh_material(geom, color)
                    updated.append((node, gname, geom, world))
                entries = updated
            return _export_scene_entries(entries, dest)

        if scope_l == "faces":
            if not indices:
                raise ValueError("Pick one or more faces before coloring faces.")
            if target_body:
                idx, (node, gname, geom, world) = _resolve_paint_entry(entries, paintable)
                entries[idx] = (node, gname, _paint_faces_geom(geom, indices), world)
                return _export_scene_entries(entries, dest)
            if len(paintable) == 1:
                i, (node, gname, geom, world) = paintable[0]
                entries[i] = (node, gname, _paint_faces_geom(geom, indices), world)
                return _export_scene_entries(entries, dest)
            offsets: list[int] = []
            off = 0
            for _i, entry in paintable:
                offsets.append(off)
                off += int(len(entry[2].faces))
            by_body: dict[int, list[int]] = {}
            for fi in indices:
                bi = body_index_for_face(fi, offsets)
                if bi < 0 or bi >= len(paintable):
                    continue
                by_body.setdefault(bi, []).append(fi - offsets[bi])
            updated_entries = list(entries)
            for bi, locals_ in by_body.items():
                entry_i, (node, gname, geom, world) = paintable[bi]
                updated_entries[entry_i] = (node, gname, _paint_faces_geom(geom, locals_), world)
            return _export_scene_entries(updated_entries, dest)

        raise ValueError("scope must be 'object' or 'faces'")

    mesh = load_mesh(path)
    if scope_l == "faces":
        if not indices:
            raise ValueError("Pick one or more faces before coloring faces.")
        mesh = paint_faces(mesh, indices, color)
        mesh = _explode_keep_face_colors(mesh)
    elif scope_l == "object":
        if target_body:
            info = mesh_body_info(mesh)
            idx = int(body_index or 0)
            if idx < 0 or idx >= int(info.get("count") or 1):
                raise ValueError(f"body_index out of range: {idx}")
            offsets = list(info.get("face_offsets") or [0])
            start = int(offsets[idx]) if idx < len(offsets) else 0
            end = int(offsets[idx + 1]) if idx + 1 < len(offsets) else len(mesh.faces)
            mesh = paint_faces(mesh, list(range(start, end)), color)
        else:
            mesh = set_mesh_material(mesh, color)
    else:
        raise ValueError("scope must be 'object' or 'faces'")
    export_mesh(mesh, dest)
    return dest


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
        meta_name = ""
        try:
            meta_name = str((body.metadata or {}).get("name") or "").strip()
        except Exception:
            meta_name = ""
        names.append(meta_name or f"Body {i + 1}")
        off += len(body.faces)
    return {
        "count": len(bodies),
        "face_offsets": offsets,
        "body_names": names,
        "can_split": len(bodies) > 1,
        "faces": int(len(mesh.faces)),
    }


def scene_body_info(path: Path) -> dict[str, Any]:
    """Body info preferring named GLB scene meshes (Fusion solids) over mesh islands."""
    path = Path(path)
    try:
        if path.stat().st_size > 8 * 1024 * 1024:
            return {"count": 0, "body_names": [], "face_offsets": [], "can_split": False, "faces": 0, "oversized": True}
    except OSError:
        return {"count": 0, "body_names": [], "face_offsets": [], "can_split": False, "faces": 0}
    try:
        scene = load_scene(path)
        parts = _meshes_from_scene(scene, source_path=path)
    except Exception:
        parts = []
    if len(parts) > 1:
        offsets: list[int] = []
        raw_names: list[str] = []
        off = 0
        total_faces = 0
        for label, mesh in parts:
            raw_names.append(str(label or "").strip())
            offsets.append(off)
            nfaces = int(len(np.asarray(getattr(mesh, "faces", []), dtype=int)))
            off += nfaces
            total_faces += nfaces
        occ = _sibling_step_occurrence_names(path.parent, path, path.name)
        authored = _sibling_authored_body_names(path.parent, path, path.name)
        names = _display_names_for_scene_bodies(raw_names, occ, authored)
        return {
            "count": len(parts),
            "face_offsets": offsets,
            "body_names": names,
            "can_split": True,
            "faces": total_faces,
        }
    return mesh_body_info(load_mesh(path))


def step_body_info(path: Path) -> dict[str, Any]:
    """Body info from STEP solid topology — gives proper part names from Fusion/cadpy."""
    path = Path(path)
    names = _authored_step_body_names(path)
    if len(names) > 1:
        display = _display_names_for_scene_bodies(names, _step_assembly_occurrence_names(path), names)
        return {
            "count": len(display),
            "face_offsets": list(range(len(display))),
            "body_names": display,
            "can_split": True,
            "faces": 0,
            "source": "step_manifold",
        }
    try:
        parts = list_step_solid_meshes(path)
    except Exception:
        parts = []
    if len(parts) > 1:
        offsets: list[int] = []
        body_names: list[str] = []
        off = 0
        total_faces = 0
        for label, mesh in parts:
            offsets.append(off)
            body_names.append(str(label or "").strip() or f"Body {len(body_names) + 1}")
            nfaces = int(len(np.asarray(getattr(mesh, "faces", []), dtype=int)))
            off += nfaces
            total_faces += nfaces
        return {
            "count": len(parts),
            "face_offsets": offsets,
            "body_names": body_names,
            "can_split": True,
            "faces": total_faces,
            "source": "step_solids",
        }
    return {"count": 1, "face_offsets": [0], "body_names": ["Body 1"], "can_split": False, "faces": 0}


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


# --------------------------------------------------------------------------- #
# Parametric FeatureProgram edits (build123d → OCCT). Mesh CSG is not used.
# --------------------------------------------------------------------------- #
def apply_program_fillet(project_path, program_name, radius_mm, *, edges="all"):
    """Append fillet to ``.program.json`` and rebuild via the CAD kernel."""
    from backend.services.program_edits import apply_program_fillet as _apply

    return _apply(project_path, program_name, radius_mm, edges=edges)


def apply_program_chamfer(project_path, program_name, length_mm, *, edges="all"):
    """Append chamfer to ``.program.json`` and rebuild via the CAD kernel."""
    from backend.services.program_edits import apply_program_chamfer as _apply

    return _apply(project_path, program_name, length_mm, edges=edges)
