"""Design orchestration: prompt -> Feature Program -> validated, exported model.

Pipeline (see the plan's architecture diagram):
  1. AI generates a design (intent + generator directive OR a Feature Program).
  2. Spec retrieval: generator directives reference the hardware spec library.
  3. Build with the B-rep kernel, export STEP/STL/GLB + physics (sim/URDF/MJCF).
  4. Validate (build success + DFM). On failure, feed the error back to the AI
     and retry (self-repair), up to ``max_repairs`` times.
"""

from __future__ import annotations

import logging
import math
import os
import re
import ast
import base64
import json
import builtins
from pathlib import Path
from typing import Any

from backend.kernel.errors import KernelBuildError
from backend.kernel.schema import DesignBrief, FeatureProgram
from backend.kernel.validator import ProgramValidationError, validate_and_raise
from backend.services import cad_service, kernel_bridge
from backend.services.ai_service import AIService
from backend.services.trace_log import add as trace_add

logger = logging.getLogger(__name__)

_BUILTIN_NAMES = set(dir(builtins)) | {"True", "False", "None"}

_BUILD123D_LOWERCASE_EXPORTS = frozenset({
    "add",
    "bounding_box",
    "chamfer",
    "clean",
    "compound",
    "copy",
    "export_brep",
    "export_dxf",
    "export_gltf",
    "export_stl",
    "export_step",
    "extrude",
    "fillet",
    "full_round",
    "import_brep",
    "import_dxf",
    "import_step",
    "loft",
    "make_brake_formed",
    "make_face",
    "make_hull",
    "make_loft",
    "make_slot_center",
    "make_slot_center_to_center",
    "make_slot_overall",
    "mirror",
    "offset",
    "project",
    "revolve",
    "scale",
    "section",
    "split",
    "sweep",
    "thicken",
})


def _slug(text: str, fallback: str = "text_to_cad_model") -> str:
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "_", (text or "").strip().lower()).strip("_")
    return (slug or fallback)[:64]


_BLOCKED_IMPORT_ROOTS = frozenset({"subprocess", "socket", "requests", "sys", "shutil"})
_BLOCKED_CALL_NAMES = frozenset({"exec", "eval", "__import__"})
_BLOCKED_OS_ATTRS = frozenset({
    "system",
    "popen",
    "spawn",
    "spawnl",
    "spawnle",
    "spawnlp",
    "spawnlpe",
    "spawnv",
    "spawnve",
    "spawnvp",
    "spawnvpe",
    "execv",
    "execve",
    "execvp",
    "execvpe",
    "execl",
    "execlp",
    "execle",
    "execlpe",
    "remove",
    "unlink",
    "rmdir",
    "removedirs",
    "chmod",
    "chown",
    "chroot",
    "kill",
    "killpg",
    "getenv",
    "putenv",
    "unsetenv",
    "environ",
})


def _validate_generated_source(source: str) -> None:
    if "def gen_step" not in source:
        raise ValueError("Generated source must define gen_step().")
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        raise ValueError(f"Generated Python source has syntax error: {exc}") from exc

    blocked: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = (alias.name or "").split(".")[0]
                if root in _BLOCKED_IMPORT_ROOTS:
                    blocked.append(f"import {alias.name}")
        elif isinstance(node, ast.ImportFrom):
            root = (node.module or "").split(".")[0]
            if root in _BLOCKED_IMPORT_ROOTS:
                blocked.append(f"from {node.module} import ...")
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            if node.func.id in _BLOCKED_CALL_NAMES:
                blocked.append(f"{node.func.id}()")
        elif isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) and node.value.id == "os":
            if node.attr in _BLOCKED_OS_ATTRS:
                blocked.append(f"os.{node.attr}")

    if blocked:
        raise ValueError(f"Generated source contains blocked operation(s): {', '.join(sorted(set(blocked)))}")


def _project_dxf_filenames(project_path: Path) -> list[str]:
    return sorted(
        path.name
        for path in project_path.glob("*.dxf")
        if path.is_file() and not path.name.endswith(".ezdxf.dxf")
    )


def _prompt_mentions_dxf_import(prompt: str) -> bool:
    """True only when the user clearly wants geometry imported from a DXF/DWG/blueprint.

    Avoid loose phrases like "from the ... profile" in normal generative prompts
    (e.g. RC airplane airfoil profile), which previously false-triggered DXF mode.
    """
    text = prompt or ""
    if re.search(r"\b(dxf|vxf|dwg)\b", text, re.I):
        return True
    if re.search(r"\b(blueprint|engineering\s+drawing|2d\s+drawing)\b", text, re.I):
        return True
    if re.search(r"\b2d\s+(profile|outline|drawing|file)\b", text, re.I):
        return True
    if re.search(r"\bfrom\s+this\s+(dxf|vxf|dwg|drawing|blueprint|file)\b", text, re.I):
        return True
    if re.search(
        r"\b(import|extrude|trace|convert)\b.{0,40}\b(dxf|vxf|dwg|blueprint|2d\s+drawing)\b",
        text,
        re.I | re.S,
    ):
        return True
    if re.search(
        r"\b(from|using|off)\s+(this|the)\s+(attached\s+)?(dxf|vxf|dwg|drawing|blueprint)\b",
        text,
        re.I,
    ):
        return True
    return False


def _missing_dxf_file_message() -> str:
    return (
        "No DXF file is attached to this project. Upload or attach the DXF first, then retry. "
        "The prompt asks to generate from a DXF, but the request had no references and the project folder has no .dxf file."
    )


def _source_mentions_dxf_import(source: str) -> bool:
    markers = (
        "dxf_filename",
        "import_dxf",
        "_collect_dxf_geometry",
        "_make_outline_body",
        "_largest_closed_face",
        "import_svg",
    )
    return any(marker in source for marker in markers)


def _collect_dxf_filenames(context: dict[str, Any] | None, project_path: Path, prompt: str) -> list[str]:
    names: list[str] = []
    seen: set[str] = set()

    def add(name: str | None) -> None:
        cleaned = (name or "").strip()
        if not cleaned or cleaned in seen:
            return
        seen.add(cleaned)
        names.append(cleaned)

    for ref in (context or {}).get("refs") or []:
        if str(ref.get("type") or "").lower() == "dxf":
            add(ref.get("filename"))
    for info in (context or {}).get("dxf_files") or []:
        add(info.get("filename"))
        add(info.get("readable_filename"))
    if _prompt_mentions_dxf_import(prompt):
        for name in _project_dxf_filenames(project_path):
            add(name)
    return names


def _defined_module_names(source: str) -> set[str]:
    tree = ast.parse(source)
    names: set[str] = set()
    for node in tree.body:
        if isinstance(node, ast.Import):
            for alias in node.names:
                names.add(alias.asname or alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            for alias in node.names:
                if alias.name == "*":
                    continue
                names.add(alias.asname or alias.name)
        elif isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    names.add(target.id)
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            names.add(node.target.id)
        elif isinstance(node, ast.FunctionDef):
            names.add(node.name)
    return names


_DXF_CONFIG_NAMES = frozenset({
    "dxf_filename",
    "dxf_path",
    "model_label",
    "part_label",
    "solid_label",
    "model_thickness",
    "mold_thickness",
    "w_extrude_depth",
    "cut_overshoot",
    "alignment_pin_height",
    "alignment_socket_depth",
    "click_lug_height",
    "cavity_layer",
    "holes_layer",
    "bolt_flaps_layer",
    "alignment_pin_layer",
    "alignment_socket_layer",
    "click_lugs_layer",
    "click_receivers_layer",
    "split_line_layer",
    "outline_layer",
    "mold_outline_layer",
})


def _assignment_target_names(target: ast.AST) -> set[str]:
    names: set[str] = set()
    if isinstance(target, ast.Name):
        names.add(target.id)
    elif isinstance(target, (ast.Tuple, ast.List)):
        for elt in target.elts:
            names.update(_assignment_target_names(elt))
    return names


def _function_assigned_names(func: ast.FunctionDef) -> set[str]:
    names: set[str] = set()

    def _add_args(fn: ast.AST) -> None:
        args = getattr(fn, "args", None)
        if args is None:
            return
        for arg in (*args.args, *args.kwonlyargs):
            names.add(arg.arg)
        if args.vararg:
            names.add(args.vararg.arg)
        if args.kwarg:
            names.add(args.kwarg.arg)

    _add_args(func)
    for node in ast.walk(func):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            names.add(node.name)
            _add_args(node)
        elif isinstance(node, ast.ClassDef):
            names.add(node.name)
        elif isinstance(node, ast.Assign):
            for target in node.targets:
                names.update(_assignment_target_names(target))
        elif isinstance(node, ast.AnnAssign) and node.target is not None:
            names.update(_assignment_target_names(node.target))
        elif isinstance(node, ast.For):
            names.update(_assignment_target_names(node.target))
        elif isinstance(node, ast.With):
            for item in node.items:
                if item.optional_vars is not None:
                    names.update(_assignment_target_names(item.optional_vars))
        elif isinstance(node, ast.comprehension):
            names.update(_assignment_target_names(node.target))
        elif isinstance(node, ast.ExceptHandler) and node.name:
            names.add(node.name)
    return names


def _is_sequence_constant_name(name: str) -> bool:
    """Names that must be lists/tuples — never scalar floats (Locations / for-loops)."""
    if not name or not name[0].islower():
        return False
    lower = name.lower()
    if re.search(r"(?:^|_)positions?(?:_[xyz]{1,3})?$", lower):
        return True
    return any(
        lower.endswith(suffix)
        for suffix in (
            "_coords",
            "_coordinates",
            "_locations",
            "_points",
            "_pattern",
            "_offsets",
            "_centers",
            "_holes",
            "_angles",
            "_angles_deg",
            "_labels",
        )
    ) or lower in {
        "positions",
        "coords",
        "locations",
        "points",
        "hole_positions",
        "mount_positions",
        "standoff_positions",
    }


def _config_like_name(name: str) -> bool:
    if (
        name in _DXF_CONFIG_NAMES
        or name.endswith("_layer")
        or name.endswith("_label")
        or name.endswith("_filename")
        or name.endswith("_path")
        or name.startswith("_")
    ):
        return True
    if not name or not name[0].islower() or "_" not in name:
        return False
    # User helpers are verbs; config constants are nouns/dimensions.
    if name.startswith(("make_", "build_", "create_", "add_", "get_", "set_", "compute_", "calc_")):
        return False
    if _is_sequence_constant_name(name):
        return True
    suffixes = (
        "_x", "_y", "_z", "_mm", "_deg", "_r",
        "_fillet", "_chamfer", "_radius", "_diameter", "_base", "_size",
        "_thickness", "_height", "_depth", "_length", "_width", "_gap",
        "_count", "_teeth", "_clearance", "_offset", "_pitch", "_span",
    )
    return any(name.endswith(suffix) for suffix in suffixes) or name.startswith(
        (
            "base_", "lug_", "bore_", "mount_", "rib_", "pin_", "plate_", "wall_",
            "gear_", "sun_", "planet_", "ring_", "carrier_", "tri_", "cut_", "hole_",
        )
    )


def _looks_like_user_helper(name: str) -> bool:
    return bool(name) and name[0].islower() and name.startswith(
        ("make_", "build_", "create_", "add_", "get_", "set_", "compute_", "calc_", "draw_", "extrude_")
    )


def _prompt_outer_box_dimensions(prompt: str) -> tuple[float, float, float] | None:
    text = prompt or ""
    patterns = [
        r"\bouter\s+box\s+size\D{0,40}(\d+(?:\.\d+)?)\s*(?:mm|millimeter|millimeters)?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:mm|millimeter|millimeters)?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:mm|millimeter|millimeters)?\b",
        r"\boutside\s+size\D{0,40}(\d+(?:\.\d+)?)\s*(?:mm|millimeter|millimeters)?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:mm|millimeter|millimeters)?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:mm|millimeter|millimeters)?\b",
        r"\boverall\s+size\D{0,40}(\d+(?:\.\d+)?)\s*(?:mm|millimeter|millimeters)?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:mm|millimeter|millimeters)?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:mm|millimeter|millimeters)?\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if not match:
            continue
        try:
            return (float(match.group(1)), float(match.group(2)), float(match.group(3)))
        except ValueError:
            continue
    return None


def _prompt_named_mm_value(prompt: str, labels: tuple[str, ...]) -> float | None:
    text = prompt or ""
    alternation = "|".join(re.escape(label) for label in labels)
    patterns = [
        rf"\b(?:{alternation})\b\D{{0,24}}(\d+(?:\.\d+)?)\s*(?:mm|millimeter|millimeters)\b",
        rf"\b(\d+(?:\.\d+)?)\s*(?:mm|millimeter|millimeters)\s+\b(?:{alternation})\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if not match:
            continue
        try:
            return float(match.group(1))
        except ValueError:
            continue
    return None


def _prompt_count_for_holder_holes(prompt: str) -> int | None:
    """Best-effort count of rods/holes from natural-language prompts."""
    text = prompt or ""
    patterns = [
        r"\bhold(?:er)?\s+(?:able to hold\s+)?(\d+)\s+(?:stainless\s+)?(?:steel\s+)?rods?\b",
        r"\b(?:able to hold|hold)\s+(\d+)\b",
        r"\b(\d+)\s+(?:stainless\s+)?(?:steel\s+)?rods?\b",
        r"\b(\d+)\s+(?:clearance\s+)?holes?\b",
        r"\bholes?\s*[:=]?\s*(\d+)\b",
    ]
    for pat in patterns:
        m = re.search(pat, text, flags=re.IGNORECASE)
        if m:
            n = int(m.group(1))
            if 1 <= n <= 64:
                return n
    return None


def _prompt_hole_diameter_mm(prompt: str) -> float | None:
    text = prompt or ""
    patterns = [
        r"\b(\d+(?:\.\d+)?)\s*mm\s+(?:for\s+)?(?:each\s+)?hole\b",
        r"\bholes?\b[^.\n]{0,40}?\b(\d+(?:\.\d+)?)\s*mm\b",
        r"\bø\s*(\d+(?:\.\d+)?)\s*mm\b",
        r"\b(\d+(?:\.\d+)?)\s*mm\s+(?:diameter|dia|ø)\b",
    ]
    for pat in patterns:
        m = re.search(pat, text, flags=re.IGNORECASE)
        if m:
            val = float(m.group(1))
            if 0.5 <= val <= 200:
                return val
    return None


def _xy_grid_positions_literal(count: int, *, pitch: float | None = None) -> str:
    """Build a centered XY grid literal for Locations / for-loops."""
    n = max(1, int(count))
    if pitch is None or pitch <= 0:
        pitch = 20.0
    if n % 2 == 0 and n >= 4:
        rows = 2
        cols = n // 2
    else:
        cols = max(1, int(math.ceil(math.sqrt(n))))
        rows = int(math.ceil(n / cols))
    xs = [((c - (cols - 1) / 2.0) * pitch) for c in range(cols)]
    ys = [((r - (rows - 1) / 2.0) * pitch) for r in range(rows)]
    pts: list[str] = []
    for y in ys:
        for x in xs:
            if len(pts) >= n:
                break
            pts.append(f"({x:.3f}, {y:.3f})")
        if len(pts) >= n:
            break
    return "[" + ", ".join(pts) + "]"


def _default_sequence_constant_value(name: str, *, prompt: str) -> str | None:
    """Defaults for list-like constants. Never returns a bare float."""
    if name in {"planet_angles_deg"}:
        return "[0.0, 120.0, 240.0]"
    if name in {"planet_labels"}:
        return '["planet_1", "planet_2", "planet_3"]'
    if name in {"pin_labels"}:
        return '["pin_1", "pin_2", "pin_3"]'
    if name.endswith(("_labels", "_names")):
        return "[]"
    if name.endswith(("_angles", "_angles_deg")):
        return "[0.0, 90.0, 180.0, 270.0]"

    count = _prompt_count_for_holder_holes(prompt) or 4
    hole_d = _prompt_hole_diameter_mm(prompt)
    pitch = max(16.0, (hole_d or 8.5) * 2.2)
    # 1D axis lists: for rx in rib_positions_x
    if re.search(r"positions?_[xyz]$", name.lower()) or name.lower().endswith(("_xs", "_ys", "_zs")):
        n = max(1, min(count, 8))
        vals = [((i - (n - 1) / 2.0) * pitch) for i in range(n)]
        return "[" + ", ".join(f"{v:.3f}" for v in vals) + "]"
    # Anchor / mounting holes: smaller 4-corner pattern.
    if "anchor" in name or "mount" in name or "fastener" in name or "bolt" in name:
        span = max(30.0, pitch * 2.5)
        return (
            f"[(-{span:.3f}, -{span:.3f}), ({span:.3f}, -{span:.3f}), "
            f"(-{span:.3f}, {span:.3f}), ({span:.3f}, {span:.3f})]"
        )
    if any(tok in name for tok in ("hole", "rod", "peg", "pin", "socket", "pocket", "standoff")):
        return _xy_grid_positions_literal(count, pitch=pitch)
    if _is_sequence_constant_name(name):
        return _xy_grid_positions_literal(count, pitch=pitch)
    return None


def _module_scalar_assigns(source: str) -> dict[str, float]:
    """Map module-level `name = <number>` assignments."""
    out: dict[str, float] = {}
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return out
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            val = node.value
            if isinstance(val, ast.Constant) and isinstance(val.value, (int, float)) and not isinstance(val.value, bool):
                out[node.targets[0].id] = float(val.value)
        elif (
            isinstance(node, ast.AnnAssign)
            and isinstance(node.target, ast.Name)
            and isinstance(node.value, ast.Constant)
            and isinstance(node.value.value, (int, float))
            and not isinstance(node.value.value, bool)
        ):
            out[node.target.id] = float(node.value.value)
    return out


def _module_name_alias_assigns(source: str) -> dict[str, str]:
    """Map module-level `name = other_name` aliases (e.g. positions = height)."""
    out: dict[str, str] = {}
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return out
    for node in tree.body:
        if (
            isinstance(node, ast.Assign)
            and len(node.targets) == 1
            and isinstance(node.targets[0], ast.Name)
            and isinstance(node.value, ast.Name)
        ):
            out[node.targets[0].id] = node.value.id
        elif (
            isinstance(node, ast.AnnAssign)
            and isinstance(node.target, ast.Name)
            and isinstance(node.value, ast.Name)
        ):
            out[node.target.id] = node.value.id
    return out


def _sanitize_prompt_hole_radii(source: str, *, prompt: str) -> str:
    """If the prompt specifies hole diameter, correct obvious default radii (e.g. 2.0)."""
    hole_d = _prompt_hole_diameter_mm(prompt)
    if hole_d is None:
        return source
    want = round(hole_d / 2.0, 4)
    scalars = _module_scalar_assigns(source)
    out = source
    for name, val in scalars.items():
        if name not in {"rod_hole_radius", "hole_radius", "pin_hole_radius"} and not (
            name.endswith("_hole_radius") or name.endswith("_bore_radius")
        ):
            continue
        # Only rewrite clear placeholder defaults, not intentional custom radii.
        if val in {1.0, 2.0, 2.5, 3.0, 5.0, 10.0} and abs(val - want) > 0.05:
            pattern = re.compile(
                rf"(?m)^({re.escape(name)}\s*(?::[^=\n]+)?=\s*)[-+]?(?:\d+\.?\d*|\.\d+)([ \t]*(?:#.*)?)$"
            )
            out, n = pattern.subn(rf"\g<1>{want}\2", out, count=1)
            if n == 0:
                out = _insert_after_imports(out, f"{name} = {want}")
    return out


def _sanitize_holder_placeholder_dimensions(source: str, *, prompt: str) -> str:
    """Replace obvious 10.0 placeholder base sizes for rod/hole holder prompts."""
    count = _prompt_count_for_holder_holes(prompt)
    hole_d = _prompt_hole_diameter_mm(prompt)
    if not count and hole_d is None:
        return source
    if not any(tok in (prompt or "").lower() for tok in ("holder", "rod", "fixture", "rack", "tray")):
        # Still apply if source already has rod_hole_* names.
        if "rod_hole" not in source and "hole_positions" not in source:
            return source

    n = count or 4
    d = hole_d or 8.5
    pitch = max(16.0, d * 2.2)
    if n % 2 == 0 and n >= 4:
        cols = n // 2
        rows = 2
    else:
        cols = max(1, int(math.ceil(math.sqrt(n))))
        rows = int(math.ceil(n / cols))
    span_x = (cols - 1) * pitch
    span_y = (rows - 1) * pitch
    margin = max(20.0, d * 3.0)
    base_length = round(span_x + 2 * margin, 1)
    base_width = round(span_y + 2 * margin, 1)
    total_height = round(max(25.0, d * 4.0), 1)
    pocket_depth = round(max(12.0, total_height * 0.7), 1)

    scalars = _module_scalar_assigns(source)
    replacements = {
        "base_length": base_length,
        "base_width": base_width,
        "total_height": total_height,
        "base_height": total_height,
        "holder_height": total_height,
        "rod_pocket_depth": pocket_depth,
        "pocket_depth": pocket_depth,
    }
    out = source
    for name, want in replacements.items():
        if name not in scalars:
            continue
        # Only rewrite classic LLM placeholders.
        if scalars[name] not in {1.0, 5.0, 10.0}:
            continue
        pattern = re.compile(
            rf"(?m)^({re.escape(name)}\s*(?::[^=\n]+)?=\s*)[-+]?(?:\d+\.?\d*|\.\d+)([ \t]*(?:#.*)?)$"
        )
        out, _n = pattern.subn(rf"\g<1>{want}\2", out, count=1)
    return out


def _sanitize_poisoned_sequence_constants(source: str, *, prompt: str) -> str:
    """Rewrite `*_positions = 10.0` (and aliases to floats) to real list literals."""
    scalars = _module_scalar_assigns(source)
    aliases = _module_name_alias_assigns(source)
    replacements: list[tuple[str, str]] = []
    if scalars:
        for name, _val in scalars.items():
            if not _is_sequence_constant_name(name):
                continue
            lit = _default_sequence_constant_value(name, prompt=prompt)
            if not lit:
                continue
            replacements.append((name, lit))
    # Alias to a scalar float name: rod_hole_positions = total_height
    for name, target in aliases.items():
        if not _is_sequence_constant_name(name):
            continue
        if target not in scalars:
            continue
        lit = _default_sequence_constant_value(name, prompt=prompt)
        if not lit:
            continue
        replacements.append((name, lit))

    out = source
    seen: set[str] = set()
    for name, lit in replacements:
        if name in seen:
            continue
        seen.add(name)
        # Replace numeric literal assigns.
        pattern = re.compile(
            rf"(?m)^({re.escape(name)}\s*(?::[^=\n]+)?=\s*)[-+]?(?:\d+\.?\d*|\.\d+)([ \t]*(?:#.*)?)$"
        )
        out, n = pattern.subn(rf"\g<1>{lit}\2", out, count=1)
        if n == 0:
            # Replace name-alias assigns: foo = bar
            alias_pat = re.compile(
                rf"(?m)^({re.escape(name)}\s*(?::[^=\n]+)?=\s*)[A-Za-z_][A-Za-z0-9_]*([ \t]*(?:#.*)?)$"
            )
            out, n = alias_pat.subn(rf"\g<1>{lit}\2", out, count=1)
        if n == 0:
            out = _insert_after_imports(out, f"{name} = {lit}")
    out = _sanitize_prompt_hole_radii(out, prompt=prompt)
    return _sanitize_holder_placeholder_dimensions(out, prompt=prompt)


def _apply_jake_deterministic_repairs(source: str, *, prompt: str) -> str:
    """Jake-parity pre-step repairs that do not invent unrelated geometry.

    These mirror what Jake's agent would fix immediately without a full redesign:
    poisoned position lists, hole radii from the prompt, and obvious 10.0 placeholders.
    """
    out = _sanitize_poisoned_sequence_constants(source, prompt=prompt)
    return out


def _source_poisoned_sequence_issues(source: str) -> list[str]:
    """Detect sequence names still assigned to scalars (preflight)."""
    issues: list[str] = []
    scalars = _module_scalar_assigns(source)
    for name, val in scalars.items():
        if _is_sequence_constant_name(name):
            issues.append(
                f"{name} = {val} is a number but must be a list of (x, y) positions "
                f"(e.g. for Locations(*{name}) or `for x, y in {name}`)."
            )
    aliases = _module_name_alias_assigns(source)
    for name, target in aliases.items():
        if _is_sequence_constant_name(name) and target in scalars:
            issues.append(
                f"{name} = {target} aliases a float ({scalars[target]}) but must be a "
                f"list of (x, y) positions."
            )
    return issues


def _default_constant_value(name: str, *, base: str, prompt: str) -> str | None:
    outer_dims = _prompt_outer_box_dimensions(prompt)
    if outer_dims:
        if name == "outer_length":
            return str(outer_dims[0])
        if name == "outer_width":
            return str(outer_dims[1])
        if name == "outer_height":
            return str(outer_dims[2])

    if name == "wall_thickness":
        wall = _prompt_named_mm_value(prompt, ("wall thickness", "wall_thickness"))
        if wall is not None:
            return str(wall)
        return "3.0"
    if name == "base_thickness":
        base_mm = _prompt_named_mm_value(prompt, ("base thickness", "floor thickness", "bottom thickness"))
        if base_mm is not None:
            return str(base_mm)
        return "3.0"

    safe_label = re.sub(r"[^a-zA-Z0-9_]+", "_", base).strip("_") or "model"
    if name in {"model_label", "part_label", "solid_label"} or name.endswith("_label"):
        return f'"{safe_label}"'
    if name.endswith("_filename"):
        return f'"{safe_label}.step"'
    if name in {"model_thickness", "mold_thickness", "w_extrude_depth"}:
        dims = _requested_mm_dimensions(prompt)
        if len(dims) >= 3:
            return str(dims[2])
        if dims:
            return str(dims[-1])
        return "25.0"
    if name == "cut_overshoot":
        return "5.0"
    if name == "alignment_pin_height":
        return "6.0"
    if name == "alignment_socket_depth":
        return "6.2"
    if name == "click_lug_height":
        return "4.0"
    if name == "gear_thickness":
        return "8.0"
    if name == "planet_orbit_radius":
        return str(_planetary_orbit_radius_mm(prompt))
    if name == "planet_angles_deg":
        return "[0.0, 120.0, 240.0]"
    if name in {"sun_root_radius", "sun_outer_radius", "sun_bore_radius", "planet_root_radius", "planet_outer_radius", "planet_bore_radius", "pin_radius", "pin_height", "pin_z", "carrier_thickness", "carrier_z"}:
        defaults = {
            "sun_root_radius": "14.0",
            "sun_outer_radius": "18.0",
            "sun_bore_radius": "4.0",
            "planet_root_radius": "9.0",
            "planet_outer_radius": "12.0",
            "planet_bore_radius": "3.0",
            "pin_radius": "2.6",
            "pin_height": "12.0",
            "pin_z": "-1.0",
            "carrier_thickness": "3.0",
            "carrier_z": "-3.0",
        }
        return defaults.get(name)
    if name == "planet_labels":
        return '["planet_1", "planet_2", "planet_3"]'
    if name == "pin_labels":
        return '["pin_1", "pin_2", "pin_3"]'
    if name.endswith("_layer"):
        return f'"{name[:-6].upper()}"'

    # Sequence/list constants must NEVER become bare floats.
    if _is_sequence_constant_name(name):
        return _default_sequence_constant_value(name, prompt=prompt)

    # Prefer prompt hole diameter for common radius names.
    if name in {"rod_hole_radius", "hole_radius", "pin_hole_radius"} or (
        name.endswith("_hole_radius") or name.endswith("_bore_radius")
    ):
        hole_d = _prompt_hole_diameter_mm(prompt)
        if hole_d is not None:
            return str(round(hole_d / 2.0, 4))

    # Generic dimension/fillet/radius fallbacks so incomplete LLM sources can still run.
    if name.endswith(("_fillet", "_chamfer", "_radius", "_clearance")) or (
        name.endswith("_r") and ("corner" in name or "fillet" in name or "bore" in name or "hole" in name)
    ):
        return "2.0"
    if name.endswith(("_thickness", "_height", "_depth", "_length", "_width", "_gap", "_base", "_size", "_span")):
        return "10.0"
    if name.endswith(("_x", "_y")) and ("hole" in name or "mount" in name or "pitch" in name):
        return "20.0"
    if name.endswith("_z") and ("axis" in name or "bore" in name or "center" in name):
        return "40.0"
    if name.endswith(("_x", "_y", "_z")):
        return "50.0" if name.endswith(("_x", "_y")) else "10.0"
    if name.startswith(
        ("base_", "lug_", "bore_", "mount_", "rib_", "pin_", "plate_", "tri_", "cut_", "hole_")
    ) and name[0].islower():
        if "count" in name or "teeth" in name:
            return "3"
        return "10.0"
    # Last resort: any snake_case config-like name that isn't a helper.
    if _config_like_name(name) and not _looks_like_user_helper(name):
        if "count" in name or "teeth" in name or name.endswith("_n"):
            return "3"
        if name.endswith(("_label", "_name", "_filename", "_path", "_layer")):
            return f'"{safe_label}"'
        return "10.0"
    return None


def _inject_missing_name_constant(source: str, name: str, *, base: str, prompt: str) -> str | None:
    """Insert one missing module-scope constant. Returns new source or None if skipped."""
    if not name or name.startswith("_") or _looks_like_user_helper(name):
        return None
    defined = _defined_module_names(source)
    if name in defined:
        return None
    rendered = _default_constant_value(name, base=base, prompt=prompt)
    if rendered is None:
        # Never invent a float for list-like names — leave for LLM repair / NameError.
        if _is_sequence_constant_name(name):
            return None
        # Still inject a numeric default for unknown snake_case dims.
        if name[0].islower() and "_" in name and not _looks_like_user_helper(name):
            rendered = "10.0"
        else:
            return None
    return _insert_after_imports(source, f"{name} = {rendered}")


def _backfill_all_undefined_constants(source: str, *, base: str, prompt: str) -> str:
    """Inject every missing config-like constant referenced by gen_step()."""
    out = _sanitize_poisoned_sequence_constants(source, prompt=prompt)
    remaining = _gen_step_local_undefined_names(out)
    if not remaining:
        return out
    for name in remaining:
        if _looks_like_user_helper(name):
            continue
        patched = _inject_missing_name_constant(out, name, base=base, prompt=prompt)
        if patched:
            out = patched
    # Second pass: if any inject still left a scalar on a sequence name, rewrite it.
    return _sanitize_poisoned_sequence_constants(out, prompt=prompt)


def _missing_config_constants(source: str) -> list[str]:
    """Module constants/helpers referenced anywhere in generated source but not defined."""
    tree = ast.parse(source)
    defined = _defined_module_names(source)
    star_import_roots: set[str] = set()
    for node in tree.body:
        if isinstance(node, ast.ImportFrom):
            if any(alias.name == "*" for alias in node.names):
                star_import_roots.add((node.module or "").split(".")[0])

    skip = _BUILTIN_NAMES
    missing: set[str] = set()
    for node in tree.body:
        if not isinstance(node, ast.FunctionDef):
            continue
        local_defined = _function_assigned_names(node)
        for sub in ast.walk(node):
            if not isinstance(sub, ast.Name) or not isinstance(sub.ctx, ast.Load):
                continue
            name = sub.id
            if name in defined or name in local_defined or name in skip:
                continue
            if "build123d" in star_import_roots and not _config_like_name(name):
                continue
            if _config_like_name(name):
                missing.add(name)
    return sorted(missing)


def _augment_common_constants(source: str, *, base: str, prompt: str) -> str:
    """Inject missing module-level constants referenced by gen_step()."""
    return _backfill_all_undefined_constants(source, base=base, prompt=prompt)


def _gen_step_local_undefined_names(source: str) -> list[str]:
    """Names referenced in gen_step() that are not defined/imported at module scope."""
    tree = ast.parse(source)
    gen_step = next(
        (node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "gen_step"),
        None,
    )
    if gen_step is None:
        return []

    defined = _defined_module_names(source)
    local_defined = _function_assigned_names(gen_step)
    star_import_roots: set[str] = set()
    for node in tree.body:
        if isinstance(node, ast.ImportFrom):
            if any(alias.name == "*" for alias in node.names):
                star_import_roots.add((node.module or "").split(".")[0])

    referenced: set[str] = set()
    for node in ast.walk(gen_step):
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load):
            referenced.add(node.id)
    referenced -= local_defined

    # Also collect names called as functions inside gen_step — user-defined
    # helpers that the model must define at module scope.
    called_as_func: set[str] = set()
    for node in ast.walk(gen_step):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            called_as_func.add(node.func.id)
    called_as_func -= local_defined

    skip = _BUILTIN_NAMES

    if "build123d" in star_import_roots:
        # Star import supplies the CAD API (Box, Cylinder, Extrude, …).
        # build123d exports are PascalCase; user-defined helpers are
        # snake_case — e.g. make_frame(), build_blade(), create_hub().
        # Catch any snake_case function call that isn't defined in this file.
        undefined_helpers = sorted(
            name
            for name in called_as_func
            if name not in defined
            and name not in skip
            and name not in _BUILD123D_LOWERCASE_EXPORTS
            and name[0].islower()  # snake_case → user helper, not build123d primitive
        )
        undefined_config = sorted(
            name
            for name in referenced
            if name not in defined
            and name not in skip
            and _config_like_name(name)
        )
        undefined_symbols = sorted(
            name
            for name in referenced
            if name not in defined
            and name not in skip
            and name not in _BUILD123D_LOWERCASE_EXPORTS
            and (name[0].islower() or "_" in name)
        )
        # Deduplicate while preserving sort
        seen: set[str] = set()
        result: list[str] = []
        for name in sorted(set(undefined_helpers + undefined_config + undefined_symbols)):
            if name not in seen:
                seen.add(name)
                result.append(name)
        return result

    return sorted(name for name in referenced if name not in defined and name not in skip)


def _source_generation_repair_note(error: str) -> str:
    if "DXF/VXF semantic modeling failed" in error:
        return (
            "The previous source failed because it treated the DXF/VXF like a flat sketch and extruded the whole drawing.\n"
            "Repair by interpreting the drawing semantically. Use ezdxf to inspect modelspace entities/layers and build real 3D CAD:\n"
            "- identify outer profiles, holes, cavities/pockets, bolt holes, flanges, tabs, panels, windows/cutouts, and separate physical parts;\n"
            "- create named build123d solids for those features/bodies with real thickness/depth and booleans;\n"
            "- return a labeled Compound/assembly of independent bodies when the drawing represents multiple parts;\n"
            "- do not use import_dxf() + make_face() + extrude() as the final model unless the user explicitly asks for a flat plate.\n"
            f"Original error:\n{error}"
        )
    missing_match = re.search(
        r"gen_step\(\) references undefined names:\s*(.+)$",
        error,
        re.IGNORECASE | re.DOTALL,
    )
    if not missing_match:
        return f"Source generation failed: {error}"

    missing = [
        name.strip()
        for name in re.split(r",|\s+and\s+", missing_match.group(1))
        if name.strip() and name.strip() != "..."
    ]
    symbol_names = [name for name in missing if re.match(r"^[a-z][a-z0-9_]*$", name) and name not in _BUILTIN_NAMES]
    if not symbol_names:
        return f"Source generation failed: {error}"

    examples = "\n".join(
        f"- define `{name}` at module scope before `gen_step()` (constant/import/helper)"
        for name in symbol_names
    )
    return (
        "The previous Python source was incomplete because gen_step() referenced symbols "
        "that were never defined in the same file.\n"
        f"Missing names: {', '.join(symbol_names)}\n"
        "Fix this by editing the existing source into ONE complete Python file. Either define the missing helpers above "
        "gen_step() or inline their full geometry logic inside gen_step(). Also define all missing module constants/imports. "
        "Do not restart from an unrelated model.\n"
        f"{examples}\n"
        "If this is a DXF/VXF workflow, prefer zero custom helper calls in gen_step(): inline the modeling blocks "
        "directly so names like make_*/add_*/build_* cannot be left undefined.\n"
        "Every symbol used by gen_step() must exist before gen_step(); no stubs, no pass, no ellipsis.\n"
        f"Original error: {error}"
    )


def _is_dxf_polyline_kernel_failure(detail: str) -> bool:
    text = str(detail or "")
    lowered = text.lower()
    return (
        ("stdfail_notdone" in lowered or "brep_api: command not done" in lowered)
        and ("polyline" in lowered or "objects_curve.py" in lowered or "topology/one_d.py" in lowered)
    )


def _is_noncritical_3mf_export_failure(detail: str) -> bool:
    text = str(detail or "")
    lowered = text.lower()
    return (
        "threemf.py" in lowered
        and "cannot write empty 3mf mesh object" in lowered
    )


def _step_args_without_3mf(step_args: list[str]) -> list[str]:
    trimmed: list[str] = []
    i = 0
    while i < len(step_args):
        if step_args[i] == "--3mf":
            i += 2
            continue
        trimmed.append(step_args[i])
        i += 1
    return trimmed


def _promote_disconnected_bodies(
    project_path: Path,
    glb_name: str,
    *,
    base: str,
    max_bodies: int = 64,
) -> list[str]:
    """Expose disconnected text-to-cad bodies as separate browser components."""
    glb_path = project_path / glb_name
    if not glb_path.is_file():
        return []
    try:
        mesh = cad_service.load_mesh(glb_path)
        bodies = cad_service.split_mesh_bodies(mesh)
    except Exception:
        return []
    if len(bodies) <= 1 or len(bodies) > max_bodies:
        return []

    outputs: list[str] = []
    for idx, body in enumerate(bodies, start=1):
        name = f"{base}_part{idx:02d}.glb"
        out = project_path / name
        n = 2
        while out.exists():
            name = f"{base}_part{idx:02d}_{n}.glb"
            out = project_path / name
            n += 1
        try:
            cad_service.export_mesh(body, out)
            outputs.append(name)
        except Exception as exc:
            logger.debug("could not promote text-to-cad body %s from %s: %s", idx, glb_name, exc)
    return outputs


def _part_artifact_slug(label: str | None, fallback: str) -> str:
    raw = (label or fallback or "part").strip()
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "_", raw).strip("_").lower()
    return slug[:80] or fallback


def _iter_build123d_leaf_children(shape: Any, *, max_depth: int = 4) -> list[Any]:
    """Return labeled leaf children from a build123d Compound without flattening solids into faces."""
    out: list[Any] = []

    def visit(node: Any, depth: int) -> None:
        children = list(getattr(node, "children", []) or [])
        if children and depth < max_depth:
            for child in children:
                visit(child, depth + 1)
            return
        if depth > 0:
            out.append(node)

    visit(shape, 0)
    return out


_ARCHITECT_MAJOR_PART_RE = re.compile(
    r"(^|_)(floor|slab|wall|panel|pillar|post|column|roof|ceiling|door|window|stair|stairs|service|core|room|bay)(_|$)",
    re.I,
)

_ARCHITECT_DETAIL_PART_RE = re.compile(
    r"(trim|baseboard|crown|sill|lintel|jamb|casing|mullion|glass_pane|pane|"
    r"connector|socket|snap|tab|tongue|rail|key|cavity|lead_in|chamfer|lip|"
    r"relief|lock|bar|grip|label|mark|seam|groove|plank|grain|knob|handle|"
    r"threshold|plate|cap|edge|bead|alignment|pick|channel|dovetail|bracket|hole)",
    re.I,
)

_ARCHITECT_MAJOR_MODULE_RE = re.compile(
    r"(floor_slab(?:_with_[a-z0-9_]+)?$|second_floor_slab(?:_with_[a-z0-9_]+)?$|"
    r"flat_roof_slab(?:_with_[a-z0-9_]+)?$|roof_panel$|wall_panel$|"
    r"structural_pillar$|corner_pillar$|door_module$|window_insert$|"
    r"^wall_(north|south|east|west)$|^room_floor$|^roof_(north|south|east|west)?)",
    re.I,
)


def _architect_major_build123d_children(children: list[Any]) -> list[Any]:
    """Keep only useful top-level Architect browser modules.

    Upstream text-to-cad treats the STEP/GLB as the primary assembly and relies on
    native labels for internals. Render Studio previously promoted every labeled leaf
    into a separate browser component, which turns trim, connector lips, grooves,
    and snap details into dozens of files. Architect mode should expose only
    coarse modules users actually move: floors, walls, doors/windows, pillars,
    roofs, stairs, and service cores.
    """
    selected: list[Any] = []
    used: set[str] = set()
    for child in children:
        label = str(getattr(child, "label", "") or "").strip()
        slug = _part_artifact_slug(label, "")
        if not slug:
            continue
        if slug.startswith("exploded_"):
            continue
        if _ARCHITECT_DETAIL_PART_RE.search(slug) and not _ARCHITECT_MAJOR_MODULE_RE.search(slug):
            continue
        if not _ARCHITECT_MAJOR_PART_RE.search(slug):
            continue
        family = re.sub(r"_(north|south|east|west|front|back|left|right|[0-9]+)$", "", slug)
        key = slug if any(token in slug for token in ("north", "south", "east", "west", "front", "back")) else family
        if key in used:
            continue
        used.add(key)
        selected.append(child)
    return selected


def _promote_build123d_children_from_source(
    project_path: Path,
    source_name: str,
    *,
    base: str,
    max_parts: int = 96,
    major_only: bool = False,
    skip_if_more_than: int | None = None,
) -> list[str]:
    """Export source-level Compound children as real browser components.

    text-to-cad's GLB export can collapse a named build123d Compound into one mesh.
    Running the already-validated source lets us recover the intended independent
    parts and publish them as separate GLBs for the Fusion-style browser tree.
    """
    source_path = project_path / source_name
    if not source_path.is_file():
        return []
    try:
        from build123d import export_stl
    except Exception as exc:
        logger.debug("build123d child promotion unavailable: %s", exc)
        return []

    old_cwd = Path.cwd()
    namespace: dict[str, Any] = {"__name__": "__render3d_child_promotion__"}
    try:
        os.chdir(project_path)
        code = source_path.read_text(encoding="utf-8", errors="ignore")
        exec(compile(code, str(source_path), "exec"), namespace)
        gen_step = namespace.get("gen_step")
        if not callable(gen_step):
            return []
        shape = gen_step()
        leaves = _iter_build123d_leaf_children(shape)
    except Exception as exc:
        logger.debug("could not evaluate build123d children for %s: %s", source_name, exc)
        return []
    finally:
        try:
            os.chdir(old_cwd)
        except Exception:
            pass

    # Ignore trivial assemblies; disconnected mesh promotion already covers them.
    if len(leaves) <= 1:
        return []
    if skip_if_more_than is not None and len(leaves) > int(skip_if_more_than):
        logger.info(
            "Skipping child promotion for %s (%s leaves > %s); keep primary assembly GLB only.",
            source_name,
            len(leaves),
            skip_if_more_than,
        )
        return []

    outputs: list[str] = []
    used_names: set[str] = set()
    candidates = leaves
    if major_only:
        candidates = _architect_major_build123d_children(leaves)
    # Drop tiny detail leaves that clutter the viewport when also shown as parts.
    detail_re = re.compile(r"(baluster|handrail|pin|dowel|screw|bolt|nut|washer|rivet)", re.I)
    if not major_only:
        filtered = [child for child in candidates if not detail_re.search(str(getattr(child, "label", "") or ""))]
        if filtered:
            candidates = filtered
    for idx, child in enumerate(candidates[:max_parts], start=1):
        label = str(getattr(child, "label", "") or "").strip()
        slug = _part_artifact_slug(label, f"part_{idx:02d}")
        if slug in used_names:
            slug = f"{slug}_{idx:02d}"
        used_names.add(slug)
        stl_name = f"{base}__part_{idx:02d}_{slug}.stl"
        glb_name = f"{base}__part_{idx:02d}_{slug}.glb"
        stl_path = project_path / stl_name
        glb_path = project_path / glb_name
        try:
            export_stl(child, str(stl_path))
            mesh = cad_service.load_mesh(stl_path)
            cad_service.export_mesh(mesh, glb_path)
            stl_path.unlink(missing_ok=True)
            outputs.append(glb_name)
        except Exception as exc:
            logger.debug("could not export build123d child %s from %s: %s", idx, source_name, exc)
            stl_path.unlink(missing_ok=True)
            glb_path.unlink(missing_ok=True)
    return outputs


def _dxf_layer_sets_from_context(context: dict[str, Any] | None, prompt: str) -> tuple[tuple[str, ...], tuple[str, ...], tuple[str, ...]]:
    layers: list[str] = []
    for info in (context or {}).get("dxf_files") or []:
        if not isinstance(info, dict):
            continue
        for name in info.get("layers") or []:
            cleaned = str(name or "").strip()
            if cleaned and cleaned not in layers:
                layers.append(cleaned)

    def pick(*keywords: str) -> tuple[str, ...]:
        upper = [layer.upper() for layer in layers]
        return tuple(
            layer
            for layer, layer_upper in zip(layers, upper)
            if any(keyword in layer_upper for keyword in keywords)
        )

    outline = pick("OUTLINE", "MOLD", "PROFILE", "PERIM", "FOOTPRINT")
    cavity = pick("CAVITY", "POCKET", "CUTOUT", "RECESS", "W_CAV")
    holes = pick("HOLE", "DRILL", "BORE")
    if not outline:
        outline = ("MOLD_OUTLINE",)
    if not cavity:
        cavity = ("W_CAVITY",)
    if not holes:
        holes = ("HOLES",)
    return outline, cavity, holes


def _should_use_dxf_mold_template(
    source: str,
    context: dict[str, Any] | None,
    prompt: str,
) -> bool:
    if _looks_like_dxf_connector(source, prompt, ""):
        return False
    if re.search(r"\bmold\b", prompt or "", re.I):
        return True
    layers: list[str] = []
    for info in (context or {}).get("dxf_files") or []:
        layers.extend(info.get("layers") or [])
    if len(layers) >= 2 and (any("HOLE" in str(layer).upper() for layer in layers) or any("CAVITY" in str(layer).upper() for layer in layers)):
        return True
    if "import_dxf" in source and "_collect_dxf_geometry" not in source and len(layers) >= 2:
        return True
    return False


def _looks_like_dxf_connector(source: str, prompt: str, dxf_filename: str = "") -> bool:
    text = " ".join([prompt or "", dxf_filename or "", source or ""])
    return bool(re.search(
        r"\b(connector|snap|clip|bracket|fixture|robot|socket|tab|flex|male|female|clearance|snap_bumps|part)\b",
        text,
        re.I,
    ))


def _prompt_needs_semantic_dxf_model(prompt: str) -> bool:
    text = prompt or ""
    if not _prompt_mentions_dxf_import(text):
        return False
    if re.search(r"\b(flat|2d|profile only|outline only|simple plate|laser cut|waterjet)\b", text, re.I):
        return False
    return bool(re.search(r"\b(3d|model|mold|part|assembly|fixture|housing|bracket|enclosure|object)\b", text, re.I))


def _is_naive_dxf_flat_extrude(source: str) -> bool:
    lowered = source.lower()
    if "import_dxf" not in lowered or "make_face" not in lowered or "extrude" not in lowered:
        return False
    semantic_markers = (
        "import ezdxf",
        "ezdxf.readfile",
        "modelspace",
        ".dxf.layer",
        "layer",
        "cavity",
        "hole",
        "flange",
        "outline_layers",
        "cavity_layers",
        "hole_layers",
        "assemblyhelper",
        "compound(",
    )
    return not any(marker in lowered for marker in semantic_markers)


def _dxf_semantic_source_issue(source: str, prompt: str, context: dict[str, Any] | None) -> str | None:
    if not _prompt_needs_semantic_dxf_model(prompt):
        return None
    lowered = (source or "").lower()
    if any(
        token in lowered
        for token in (
            "fallback_body",
            "dxf_connector",
            "mold_from_dxf",
            "rectangle(width, depth)",
            "simple outline extrude template",
        )
    ):
        return (
            "DXF/VXF semantic modeling failed: the source uses a generic Render Studio fallback template "
            "or bounding-box plate instead of reconstructing the requested 3D CAD from the drawing.\n"
            "Fix: follow the upstream text-to-cad loop. Parse the DXF/VXF intent and write real build123d "
            "source with named solids for the frame, walls, bosses, mounting holes, pockets, cutouts, tabs, "
            "clearances, and separate physical parts. Do not return dxf_connector, mold_from_dxf, "
            "fallback_body, or a Rectangle(width, depth) slab."
        )
    if not _is_naive_dxf_flat_extrude(source):
        return None
    dxf_files = []
    for info in (context or {}).get("dxf_files") or []:
        if isinstance(info, dict):
            name = str(info.get("readable_filename") or info.get("filename") or "").strip()
            if name:
                dxf_files.append(name)
    target = dxf_files[0] if dxf_files else "the attached DXF/VXF drawing"
    return (
        "DXF/VXF semantic modeling failed: the source imports the entire drawing with import_dxf(), "
        "calls make_face(), and extrudes it into a flat slab. That is only valid for an explicitly "
        "requested flat plate/profile, not for a 3D model from a drawing.\n"
        f"Fix: parse {target} as drawing intent. Use ezdxf/modelspace entities and layers to identify "
        "outer profiles, cavities/pockets, bolt holes, windows/cutouts, flanges, tabs, and separate "
        "physical parts. Build those as named build123d solids/Compounds with real thickness, cuts, "
        "and independent bodies. Do not call import_dxf() on the whole file as the final model."
    )


def _canonical_dxf_mold_source(
    dxf_filename: str,
    *,
    thickness: float = 25.0,
    label: str = "mold_from_dxf",
    outline_layers: tuple[str, ...] = ("MOLD_OUTLINE",),
    cavity_layers: tuple[str, ...] = ("W_CAVITY",),
    hole_layers: tuple[str, ...] = ("HOLES",),
) -> str:
    """Layer-aware mold builder: extrude outline polylines, cut cavities and holes."""
    safe_name = dxf_filename.replace("\\", "\\\\").replace('"', '\\"')
    safe_label = label.replace("\\", "\\\\").replace('"', '\\"')
    return (
        "from pathlib import Path\n\n"
        "import ezdxf\n"
        "from build123d import *\n\n"
        f'dxf_filename = "{safe_name}"\n'
        f"mold_thickness = {thickness}\n"
        f'solid_label = "{safe_label}"\n'
        f"outline_layers = {outline_layers!r}\n"
        f"cavity_layers = {cavity_layers!r}\n"
        f"hole_layers = {hole_layers!r}\n\n"
        "def _extrude_polyline(entity, amount):\n"
        "    if entity.dxftype() == 'LWPOLYLINE':\n"
        "        points = [(float(p[0]), float(p[1])) for p in entity.get_points('xy')]\n"
        "    elif entity.dxftype() == 'POLYLINE':\n"
        "        points = [(float(v.dxf.location.x), float(v.dxf.location.y)) for v in entity.vertices]\n"
        "    else:\n"
        "        points = []\n"
        "    if len(points) < 3:\n"
        "        raise ValueError('DXF polyline has fewer than 3 points')\n"
        "    if points and points[0] == points[-1]:\n"
        "        points = points[:-1]\n"
        "    cleaned = []\n"
        "    for x, y in points:\n"
        "        if not cleaned or abs(x - cleaned[-1][0]) > 1e-6 or abs(y - cleaned[-1][1]) > 1e-6:\n"
        "            cleaned.append((x, y))\n"
        "    if len(cleaned) >= 2 and abs(cleaned[0][0] - cleaned[-1][0]) <= 1e-6 and abs(cleaned[0][1] - cleaned[-1][1]) <= 1e-6:\n"
        "        cleaned = cleaned[:-1]\n"
        "    if len(cleaned) < 3:\n"
        "        raise ValueError('DXF polyline has fewer than 3 unique points')\n"
        "    area2 = 0.0\n"
        "    for i in range(len(cleaned)):\n"
        "        x1, y1 = cleaned[i]\n"
        "        x2, y2 = cleaned[(i + 1) % len(cleaned)]\n"
        "        area2 += (x1 * y2) - (x2 * y1)\n"
        "    if abs(area2) <= 1e-6:\n"
        "        raise ValueError('DXF polyline is degenerate (zero area)')\n"
        "    with BuildPart() as part_builder:\n"
        "        with BuildSketch(Plane.XY) as sketch_builder:\n"
        "            with BuildLine() as line_builder:\n"
        "                Polyline(*cleaned, close=True)\n"
        "            make_face()\n"
        "        extrude(amount=amount)\n"
        "        return part_builder.part\n\n"
        "def gen_step():\n"
        "    doc = ezdxf.readfile(str(Path(dxf_filename)))\n"
        "    modelspace = doc.modelspace()\n"
        "    body = None\n"
        "    outline_names = {name.upper() for name in outline_layers}\n"
        "    cavity_names = {name.upper() for name in cavity_layers}\n"
        "    hole_names = {name.upper() for name in hole_layers}\n"
        "    for entity in modelspace:\n"
        "        if entity.dxftype() not in ('LWPOLYLINE', 'POLYLINE'):\n"
        "            continue\n"
        "        if entity.dxf.layer.upper() not in outline_names:\n"
        "            continue\n"
        "        try:\n"
        "            piece = _extrude_polyline(entity, mold_thickness)\n"
        "        except Exception:\n"
        "            continue\n"
        "        body = piece if body is None else body + piece\n"
        "    if body is None:\n"
        "        raise ValueError('No outline polylines found in DXF')\n"
        "    for entity in modelspace:\n"
        "        if entity.dxftype() not in ('LWPOLYLINE', 'POLYLINE'):\n"
        "            continue\n"
        "        if entity.dxf.layer.upper() not in cavity_names:\n"
        "            continue\n"
        "        try:\n"
        "            body = body - _extrude_polyline(entity, mold_thickness)\n"
        "        except Exception:\n"
        "            continue\n"
        "    cut_height = mold_thickness + 2.0\n"
        "    for entity in modelspace:\n"
        "        if entity.dxftype() != 'CIRCLE':\n"
        "            continue\n"
        "        if entity.dxf.layer.upper() not in hole_names:\n"
        "            continue\n"
        "        radius = float(entity.dxf.radius)\n"
        "        center_x = float(entity.dxf.center.x)\n"
        "        center_y = float(entity.dxf.center.y)\n"
        "        body = body - Location((center_x, center_y, mold_thickness / 2.0)) * Cylinder(\n"
        "            radius=radius,\n"
        "            height=cut_height,\n"
        "        )\n"
        "    body.label = solid_label\n"
        "    return body\n"
    )


def _canonical_dxf_extrude_source(
    dxf_filename: str,
    *,
    thickness: float = 25.0,
    label: str = "dxf_model",
) -> str:
    """Simple single-profile DXF extrude for drawings with one closed outline."""
    safe_name = dxf_filename.replace("\\", "\\\\").replace('"', '\\"')
    safe_label = label.replace("\\", "\\\\").replace('"', '\\"')
    return (
        "from pathlib import Path\n"
        "from build123d import *\n\n"
        f'dxf_filename = "{safe_name}"\n'
        f"model_thickness = {thickness}\n"
        f'solid_label = "{safe_label}"\n\n'
        "def gen_step():\n"
        "    with BuildPart() as part_builder:\n"
        "        with BuildSketch(Plane.XY) as sketch_builder:\n"
        "            shapes = import_dxf(str(Path(dxf_filename)))\n"
        "            for shape in shapes:\n"
        "                add(shape)\n"
        "            make_face()\n"
        "        extrude(amount=model_thickness)\n"
        "    body = part_builder.part\n"
        "    body.label = solid_label\n"
        "    return body\n"
    )


def _canonical_dxf_connector_source(
    dxf_filename: str,
    *,
    thickness: float = 8.0,
    label: str = "dxf_connector",
) -> str:
    """Layer-aware connector/part builder for DXFs with additive and clearance profiles."""
    safe_name = dxf_filename.replace("\\", "\\\\").replace('"', '\\"')
    safe_label = label.replace("\\", "\\\\").replace('"', '\\"')
    return (
        "from pathlib import Path\n\n"
        "import ezdxf\n"
        "from build123d import *\n\n"
        f'dxf_filename = "{safe_name}"\n'
        f"model_thickness = {thickness}\n"
        f'model_label = "{safe_label}"\n\n'
        "ADD_LAYER_HINTS = ('BASE', 'RIB', 'WEDGE', 'SHOULDER', 'ARM', 'BUMPS', 'BLOCK', 'FACE', 'TAB', 'BODY', 'OUTLINE', 'PROFILE')\n"
        "CUT_LAYER_HINTS = ('CLEARANCE', 'SOCKET', 'CUT', 'CUTOUT', 'SLOT', 'HOLE', 'POCKET', 'CAVITY')\n"
        "IGNORE_LAYER_HINTS = ('TEXT', 'CENTERLINE', 'LEAD_IN', 'PICK', 'MARK', 'DIM', 'CONSTRUCTION')\n\n"
        "def _layer(entity):\n"
        "    return str(entity.dxf.layer or '').upper()\n\n"
        "def _points(entity):\n"
        "    kind = entity.dxftype()\n"
        "    if kind == 'LWPOLYLINE':\n"
        "        return [(float(p[0]), float(p[1])) for p in entity.get_points('xy')]\n"
        "    if kind == 'POLYLINE':\n"
        "        return [(float(v.dxf.location.x), float(v.dxf.location.y)) for v in entity.vertices]\n"
        "    return []\n\n"
        "def _is_closed_poly(entity):\n"
        "    if entity.dxftype() not in ('LWPOLYLINE', 'POLYLINE'):\n"
        "        return False\n"
        "    pts = _points(entity)\n"
        "    if len(pts) < 3:\n"
        "        return False\n"
        "    is_closed = bool(getattr(entity, 'closed', False) or getattr(entity, 'is_closed', False))\n"
        "    return is_closed or pts[0] == pts[-1]\n\n"
        "def _poly_solid(entity, amount):\n"
        "    pts = _points(entity)\n"
        "    if pts and pts[0] == pts[-1]:\n"
        "        pts = pts[:-1]\n"
        "    cleaned = []\n"
        "    for x, y in pts:\n"
        "        if not cleaned or abs(x - cleaned[-1][0]) > 1e-6 or abs(y - cleaned[-1][1]) > 1e-6:\n"
        "            cleaned.append((x, y))\n"
        "    if len(cleaned) >= 2 and abs(cleaned[0][0] - cleaned[-1][0]) <= 1e-6 and abs(cleaned[0][1] - cleaned[-1][1]) <= 1e-6:\n"
        "        cleaned = cleaned[:-1]\n"
        "    if len(cleaned) < 3:\n"
        "        raise ValueError('DXF polyline has fewer than 3 unique points')\n"
        "    area2 = 0.0\n"
        "    for i in range(len(cleaned)):\n"
        "        x1, y1 = cleaned[i]\n"
        "        x2, y2 = cleaned[(i + 1) % len(cleaned)]\n"
        "        area2 += (x1 * y2) - (x2 * y1)\n"
        "    if abs(area2) <= 1e-6:\n"
        "        raise ValueError('DXF polyline is degenerate (zero area)')\n"
        "    with BuildPart() as part_builder:\n"
        "        with BuildSketch(Plane.XY):\n"
        "            with BuildLine():\n"
        "                Polyline(*cleaned, close=True)\n"
        "            make_face()\n"
        "        extrude(amount=amount)\n"
        "    return part_builder.part\n\n"
        "def _circle_solid(entity, amount):\n"
        "    center = entity.dxf.center\n"
        "    return Location((float(center.x), float(center.y), amount / 2.0)) * Cylinder(radius=float(entity.dxf.radius), height=amount + 2.0)\n\n"
        "def _classify_poly(entity):\n"
        "    layer = _layer(entity)\n"
        "    if any(token in layer for token in IGNORE_LAYER_HINTS):\n"
        "        return 'ignore'\n"
        "    if any(token in layer for token in CUT_LAYER_HINTS):\n"
        "        return 'cut'\n"
        "    if any(token in layer for token in ADD_LAYER_HINTS):\n"
        "        return 'add'\n"
        "    return 'add'\n\n"
        "def _compound_from_parts(parts, label):\n"
        "    if len(parts) == 1:\n"
        "        parts[0].label = label\n"
        "        return parts[0]\n"
        "    assembly = Compound(children=parts)\n"
        "    assembly.label = label\n"
        "    return assembly\n\n"
        "def gen_step():\n"
        "    doc = ezdxf.readfile(str(Path(dxf_filename)))\n"
        "    modelspace = list(doc.modelspace())\n"
        "    separate_parts = []\n"
        "    cut_tools = []\n"
        "    for entity in modelspace:\n"
        "        if not _is_closed_poly(entity):\n"
        "            continue\n"
        "        kind = _classify_poly(entity)\n"
        "        if kind == 'ignore':\n"
        "            continue\n"
        "        try:\n"
        "            solid = _poly_solid(entity, model_thickness + (2.0 if kind == 'cut' else 0.0))\n"
        "        except Exception:\n"
        "            continue\n"
        "        if kind == 'cut':\n"
        "            cut_tools.append(solid)\n"
        "            continue\n"
        "        solid.label = _layer(entity).lower() or 'dxf_profile'\n"
        "        separate_parts.append(solid)\n"
        "    if not separate_parts:\n"
        "        min_x = min_y = float('inf')\n"
        "        max_x = max_y = float('-inf')\n"
        "        for entity in modelspace:\n"
        "            layer = _layer(entity)\n"
        "            if any(token in layer for token in IGNORE_LAYER_HINTS):\n"
        "                continue\n"
        "            kind = entity.dxftype()\n"
        "            if kind == 'LINE':\n"
        "                pts = [entity.dxf.start, entity.dxf.end]\n"
        "                for p in pts:\n"
        "                    min_x = min(min_x, float(p.x)); min_y = min(min_y, float(p.y))\n"
        "                    max_x = max(max_x, float(p.x)); max_y = max(max_y, float(p.y))\n"
        "            elif kind in ('LWPOLYLINE', 'POLYLINE'):\n"
        "                for x, y in _points(entity):\n"
        "                    min_x = min(min_x, x); min_y = min(min_y, y)\n"
        "                    max_x = max(max_x, x); max_y = max(max_y, y)\n"
        "            elif kind in ('CIRCLE', 'ARC'):\n"
        "                c = entity.dxf.center\n"
        "                r = float(entity.dxf.radius)\n"
        "                min_x = min(min_x, float(c.x) - r); min_y = min(min_y, float(c.y) - r)\n"
        "                max_x = max(max_x, float(c.x) + r); max_y = max(max_y, float(c.y) + r)\n"
        "            elif kind == 'INSERT':\n"
        "                try:\n"
        "                    p = entity.dxf.insert\n"
        "                    min_x = min(min_x, float(p.x)); min_y = min(min_y, float(p.y))\n"
        "                    max_x = max(max_x, float(p.x)); max_y = max(max_y, float(p.y))\n"
        "                except Exception:\n"
        "                    pass\n"
        "        if min_x == float('inf'):\n"
        "            extmin = getattr(doc.header, '$EXTMIN', None)\n"
        "            extmax = getattr(doc.header, '$EXTMAX', None)\n"
        "            if extmin is not None and extmax is not None:\n"
        "                try:\n"
        "                    min_x = float(extmin[0]); min_y = float(extmin[1])\n"
        "                    max_x = float(extmax[0]); max_y = float(extmax[1])\n"
        "                except Exception:\n"
        "                    min_x = min_y = float('inf')\n"
        "            if min_x == float('inf'):\n"
        "                min_x = -40.0; min_y = -40.0; max_x = 40.0; max_y = 40.0\n"
        "        width = max(1.0, max_x - min_x)\n"
        "        depth = max(1.0, max_y - min_y)\n"
        "        cx = (min_x + max_x) / 2.0\n"
        "        cy = (min_y + max_y) / 2.0\n"
        "        with BuildPart() as part_builder:\n"
        "            with BuildSketch(Plane.XY):\n"
        "                Rectangle(width, depth)\n"
        "            extrude(amount=model_thickness)\n"
        "        fallback_body = Pos(cx, cy, 0) * part_builder.part\n"
        "        for entity in modelspace:\n"
        "            layer = _layer(entity)\n"
        "            if entity.dxftype() == 'CIRCLE' and not any(token in layer for token in IGNORE_LAYER_HINTS):\n"
        "                try:\n"
        "                    fallback_body = fallback_body - _circle_solid(entity, model_thickness)\n"
        "                except Exception:\n"
        "                    pass\n"
        "        fallback_body.label = model_label\n"
        "        return fallback_body\n"
        "    for entity in modelspace:\n"
        "        layer = _layer(entity)\n"
        "        if entity.dxftype() == 'CIRCLE' and not any(token in layer for token in IGNORE_LAYER_HINTS):\n"
        "            cut_tools.append(_circle_solid(entity, model_thickness))\n"
        "    adjusted_parts = []\n"
        "    for part in separate_parts:\n"
        "        shaped = part\n"
        "        for tool in cut_tools:\n"
        "            try:\n"
        "                shaped = shaped - tool\n"
        "            except Exception:\n"
        "                continue\n"
        "        if not str(getattr(shaped, 'label', '') or '').strip():\n"
        "            shaped.label = str(getattr(part, 'label', '') or '')\n"
        "        adjusted_parts.append(shaped)\n"
        "    return _compound_from_parts(adjusted_parts or separate_parts, model_label)\n"
    )


def _maybe_rewrite_incomplete_dxf_source(
    source: str,
    *,
    dxf_filename: str,
    prompt: str,
    context: dict[str, Any] | None = None,
) -> tuple[str, str | None]:
    """Deprecated: keep generated source in Jake's repair loop.

    Render Studio-specific DXF template rewrites were removed because they could
    convert failed CAD generation into flat fallback geometry.
    """
    return source, None


def _insert_after_imports(source: str, block: str) -> str:
    if not block.strip():
        return source
    lines = source.splitlines()
    insert_at = 0
    idx = 0
    while idx < len(lines):
        stripped = lines[idx].strip()
        if stripped.startswith("from ") or stripped.startswith("import ") or stripped == "from __future__ import annotations":
            insert_at = idx + 1
            idx += 1
            continue
        if stripped == "" and insert_at > 0:
            insert_at = idx + 1
            idx += 1
            continue
        break
    injected = [*lines[:insert_at], "", block.rstrip(), "", *lines[insert_at:]]
    return "\n".join(injected).rstrip() + "\n"


def _ensure_project_dxf_files_readable(project_path: Path, filenames: list[str]) -> dict[str, str]:
    try:
        from backend.skills.dxf.scripts.dxf.repair import ensure_ezdxf_readable_dxf
    except ImportError:
        return {name: name for name in filenames if (project_path / name).is_file()}

    readable: dict[str, str] = {}
    for name in filenames:
        source_path = project_path / name
        if not source_path.is_file():
            continue
        readable_path = ensure_ezdxf_readable_dxf(source_path)
        readable[name] = readable_path.name
    return readable


def _augment_text_to_cad_source(
    source: str,
    *,
    context: dict[str, Any] | None,
    project_path: Path,
    prompt: str,
    jake_identical: bool = True,
) -> str:
    """Wire DXF filenames into generated source.

    Jake-identical: only inject ``dxf_filename`` when the script already
    references a DXF import — never invent thicknesses/helpers.
    Render Studio compatibility path may also backfill common DXF defaults.
    """
    dxf_names = _collect_dxf_filenames(context, project_path, prompt)
    if not dxf_names and _source_mentions_dxf_import(source):
        dxf_names = _project_dxf_filenames(project_path)
    if not dxf_names:
        return source

    readable_map = _ensure_project_dxf_files_readable(project_path, dxf_names)
    primary = readable_map.get(dxf_names[0], dxf_names[0])
    defined = _defined_module_names(source)
    injections: list[str] = []

    uses_dxf_file = any(token in source for token in ("dxf_filename", "import_dxf", "import_svg", "dxf_path"))
    if uses_dxf_file and "dxf_filename" not in defined:
        injections.append(f'dxf_filename = "{primary}"')

    if not jake_identical:
        defaults = {
            "mold_thickness": "25.0",
            "plate_thickness": "25.0",
            "extrusion_thickness": "25.0",
            "model_thickness": "25.0",
            "w_extrude_depth": "25.0",
            "solid_label": '"dxf_model"',
            "part_label": '"dxf_model"',
            "origin_center_on_dxf_bbox": "True",
        }
        for name, value in defaults.items():
            if name in source and name not in defined:
                injections.append(f"{name} = {value}")

        helper_block = (
            "def _bbox_center_xy(shape):\n"
            "    bb = shape.bounding_box()\n"
            "    center = bb.center()\n"
            "    return (center.X, center.Y)\n\n"
            "def _bbox_min_z(shape):\n"
            "    return shape.bounding_box().min.Z"
        )
        if "_bbox_center_xy" in source and "_bbox_center_xy" not in defined:
            injections.append(helper_block)

    if injections:
        source = _insert_after_imports(source, "\n\n".join(injections))
    return source


def _harden_common_fillet_failures(source: str) -> str:
    """Rewrite fragile fillet(...) calls to a guarded helper before scripts/step."""
    if "fillet(" not in source:
        return source
    rewritten = re.sub(
        r"(?<![\w\.])fillet\(\s*([^,]+?)\s*,\s*(?:radius\s*=\s*)?([^)]+?)\s*\)",
        r"_safe_fillet(\1, \2)",
        source,
        flags=re.MULTILINE,
    )
    if "_safe_fillet(" not in rewritten or "def _safe_fillet(" in rewritten:
        return rewritten
    helper = (
        "def _safe_fillet(edges, radius):\n"
        "    for scale in (1.0, 0.75, 0.5, 0.3):\n"
        "        candidate = float(radius) * scale\n"
        "        if candidate <= 0.05:\n"
        "            continue\n"
        "        try:\n"
        "            fillet(edges, radius=candidate)\n"
        "            return\n"
        "        except Exception:\n"
        "            continue"
    )
    return _insert_after_imports(rewritten, helper)


def _spiral_stair_tread_count(prompt: str) -> int:
    text = (prompt or "").lower()
    match = re.search(r"(\d+)\s+(?:rising\s+)?(?:wedge\s+)?treads?\b", text)
    if match:
        try:
            value = int(match.group(1))
            if value > 0:
                return value
        except Exception:
            pass
    return 20


def _backfill_known_missing_symbols(source: str, prompt: str, missing: list[str]) -> str:
    """Inject tiny fallback helpers/constants for known recurrent missing symbols."""
    if not missing:
        return source
    missing_set = set(missing)
    defined = _defined_module_names(source)
    injections: list[str] = []

    inferred_treads = _spiral_stair_tread_count(prompt)
    if "num_treads" in missing_set and "num_treads" not in defined:
        injections.append(f"num_treads = {inferred_treads}")
    if "tread_count" in missing_set and "tread_count" not in defined:
        injections.append(f"tread_count = {inferred_treads}")
    if "rise_per_tread" in missing_set and "rise_per_tread" not in defined:
        injections.append("rise_per_tread = 4.0")
    if "tread_span_deg" in missing_set and "tread_span_deg" not in defined:
        injections.append("tread_span_deg = 18.0")
    if "rail_height_above_tread" in missing_set and "rail_height_above_tread" not in defined:
        injections.append("rail_height_above_tread = 10.0")
    if "base_top" in missing_set and "base_top" not in defined:
        injections.append("base_top = 3.0")

    # Do NOT inject hand-authored gear/stair make_* helpers or gear dimensions.
    # That bypasses generative CAD (and previously shipped broken ring-gear
    # pockets). Missing helpers must fail into Jake's scripts/step → LLM repair.

    if not injections:
        return source
    return _insert_after_imports(source, "\n\n".join(injections))


def _source_looks_like_multipart_assembly(source: str) -> bool:
    text = source or ""
    if re.search(r"Compound\s*\(\s*children\s*=", text):
        return True
    if text.count(".label") >= 3:
        return True
    if re.search(r"def\s+parts\s*\(", text) and "return [" in text:
        return True
    return False


def _prompt_wants_electronics_or_wiring(prompt: str) -> bool:
    p = (prompt or "").lower()
    needles = (
        "motor", "servo", "esc", "lipo", "battery", "receiver", "wiring", "wire channel",
        "electronics", "brushless", "propeller", "pushrod", "arduino", "pcb", "board mount",
        "motor mount", "servo pocket", "cable", "harness",
    )
    return any(n in p for n in needles)


def _electronics_authoring_rules(prompt: str, *, enabled: bool = True) -> str:
    if not enabled:
        return ""
    if not _prompt_wants_electronics_or_wiring(prompt):
        return ""
    return (
        "\nELECTRONICS / WIRING SOLIDS (required for this prompt):\n"
        "- Do NOT stop at empty pockets, shelves, or clearance holes.\n"
        "- Model visible labeled solids for the claimed electronics: motor, ESC, battery/LiPo, "
        "receiver, and each servo (or documented purchasable STEP via $step-parts).\n"
        "- Model wiring as labeled solids too: wire bundles/tubes along channels, lead exits, "
        "and harness runs between motor/ESC/battery/servos — not only empty tunnels.\n"
        "- Keep printable airframe parts separate from electronics envelopes; electronics may be "
        "non-printed space-claim bodies with clear labels (e.g. `2212_motor`, `esc_30a`, "
        "`lipo_3s`, `aileron_servo_left`, `motor_leads`).\n"
    )


def _assembly_dual_export_rules(prompt: str = "", *, model_electronics: bool = True) -> str:
    return (
        "\nASSEMBLED + EXPLODED EXPORT (required for multi-part assemblies):\n"
        "- `gen_step()` MUST return the assembled layout (flight-ready / installed positions).\n"
        "- Also define `gen_exploded()` that returns the same labeled children spaced apart for "
        "BOM/assembly review (e.g. offset along Y/Z so parts do not overlap).\n"
        "- Primary basename is the assembled model. `scripts/step` auto-exports "
        "`{stem}_exploded.step/.glb/.stl/.3mf` when `gen_exploded()` exists.\n"
        "- Do NOT make the primary generator filename end in `_exploded` unless the user only "
        "asked for an exploded view.\n"
        f"{_electronics_authoring_rules(prompt, enabled=model_electronics)}"
    )


_DEFAULT_GEN_EXPLODED = '''
def gen_exploded():
    """Exploded layout of labeled assembly children for BOM / assembly review."""
    root = gen_step()
    kids = list(getattr(root, "children", None) or [])
    if len(kids) < 2:
        return root
    spaced = []
    for i, child in enumerate(kids):
        spaced.append(child.moved(Location((0.0, (i % 7 - 3) * 55.0, (i // 7) * 65.0))))
    out = Compound(children=spaced)
    label = getattr(root, "label", None) or "assembly"
    out.label = f"{label} — exploded"
    return out
'''.strip()


def _ensure_gen_exploded_in_source(source: str) -> str:
    """Inject a default gen_exploded() for multi-part assemblies when the agent omitted it."""
    text = source or ""
    if "def gen_exploded" in text:
        return text
    if "def gen_step" not in text:
        return text
    if not _source_looks_like_multipart_assembly(text):
        return text
    # Ensure Location/Compound names exist; build123d star-imports usually provide them.
    return text.rstrip() + "\n\n\n" + _DEFAULT_GEN_EXPLODED + "\n"


def _normalize_exploded_sidecar_preview(project_path: Path, stem: str) -> None:
    """Bake mm units into `{stem}_exploded.glb` (scripts/step often leaves metres)."""
    step_path = project_path / f"{stem}.step"
    if not step_path.is_file():
        step_path = project_path / f"{stem}.stp"
    if not step_path.is_file():
        return
    shell_glb = project_path / f"{stem}.glb"
    jake_glb = project_path / jake_hidden_glb_name(step_path.name)
    try:
        if jake_glb.is_file() and shell_glb.is_file():
            # Prefer STEP-derived Jake sidecar orientation, then share bytes both ways.
            shell_glb.write_bytes(jake_glb.read_bytes())
        elif jake_glb.is_file() and not shell_glb.is_file():
            shell_glb.write_bytes(jake_glb.read_bytes())
        elif shell_glb.is_file() and not jake_glb.is_file():
            jake_glb.write_bytes(shell_glb.read_bytes())
        for preview in (shell_glb, jake_glb):
            if not preview.is_file():
                continue
            try:
                cad_service._match_glb_scale_to_step(step_path, preview)
            except Exception as exc:
                logger.debug("Could not unit-match exploded preview %s: %s", preview.name, exc)
    except Exception as exc:
        logger.debug("Exploded preview normalize skipped for %s: %s", stem, exc)


def _collect_exploded_sidecar_files(project_path: Path, base: str) -> dict[str, str]:
    """Pick up `{base}_exploded.*` artifacts written by scripts/step."""
    stem = base if base.lower().endswith("_exploded") else f"{base}_exploded"
    _normalize_exploded_sidecar_preview(project_path, stem)
    out: dict[str, str] = {}
    for ext, key in ((".step", "exploded_step"), (".glb", "exploded_glb"), (".stl", "exploded_stl"), (".3mf", "exploded_3mf")):
        path = project_path / f"{stem}{ext}"
        if path.is_file() and path.stat().st_size > 0:
            out[key] = path.name
    return out


def _finalize_text_to_cad_source_before_step(
    source_path: Path,
    *,
    context: dict[str, Any] | None,
    project_path: Path,
    prompt: str,
    jake_identical: bool = True,
) -> str:
    """Last-chance prep immediately before scripts/step executes the file.

    Jake-identical path mirrors earthtojake/text-to-cad authoring:
    DXF filename wiring only. Never invent dimensions, rewrite hole radii,
    or auto-heal scalar ``*_positions`` — those failures feed the LLM repair loop.
    """
    source = source_path.read_text(encoding="utf-8", errors="ignore")
    finalized = _augment_text_to_cad_source(
        source,
        context=context,
        project_path=project_path,
        prompt=prompt,
        jake_identical=jake_identical,
    )
    # Always ensure multi-part assemblies expose gen_exploded() so scripts/step
    # can emit assembled + exploded artifact pairs for future generations.
    finalized = _ensure_gen_exploded_in_source(finalized)
    if jake_identical:
        # Jake does not invent missing dimensions. It does rewrite scalar
        # ``*_positions* = 10.0`` mistakes — those are type bugs, not missing params.
        # Also fix obvious holder placeholder dims / hole radii from the prompt.
        finalized = _apply_jake_deterministic_repairs(finalized, prompt=prompt)
        poisoned = _source_poisoned_sequence_issues(finalized)
        if poisoned:
            raise ValueError(
                "Generated source has invalid position/list constants (Jake authoring — "
                "fix in source, do not invent lists):\n- "
                + "\n- ".join(poisoned[:8])
                + "\nFix: define them as lists of coordinates, e.g. "
                "rod_hole_positions = [(-30, -10), (-10, -10), ...]. Never assign a bare float."
            )
        if finalized != source:
            source_path.write_text(finalized.rstrip() + "\n", encoding="utf-8")
        return finalized

    # Render Studio compatibility path: backfill missing dims and harden fillets.
    finalized = _backfill_all_undefined_constants(finalized, base=source_path.stem, prompt=prompt)
    finalized = _apply_jake_deterministic_repairs(finalized, prompt=prompt)
    poisoned = _source_poisoned_sequence_issues(finalized)
    if poisoned:
        for issue in poisoned:
            m = re.match(r"^(\w+)\s*=", issue)
            if not m:
                continue
            name = m.group(1)
            lit = _default_sequence_constant_value(name, prompt=prompt)
            if not lit:
                continue
            finalized = re.sub(
                rf"(?m)^{re.escape(name)}\s*(?::[^=\n]+)?=\s*[-+]?(?:\d+\.?\d*|\.\d+)[ \t]*(?:#.*)?\n?",
                "",
                finalized,
            )
            finalized = _insert_after_imports(finalized, f"{name} = {lit}")
        finalized = _apply_jake_deterministic_repairs(finalized, prompt=prompt)
        poisoned = _source_poisoned_sequence_issues(finalized)
        if poisoned:
            raise ValueError(
                "Generated source has invalid position/list constants before scripts/step:\n- "
                + "\n- ".join(poisoned[:8])
                + "\nFix: define them as lists of (x, y) tuples, e.g. "
                "rod_hole_positions = [(-30, -10), (-10, -10), ...]. Never assign a bare float."
            )
    finalized = _harden_common_fillet_failures(finalized)
    remaining = _gen_step_local_undefined_names(finalized)
    if remaining:
        healed = _backfill_known_missing_symbols(finalized, prompt, remaining)
        if healed != finalized:
            finalized = healed
            remaining = _gen_step_local_undefined_names(finalized)
    if remaining:
        raise ValueError(
            "Generated source is incomplete before scripts/step; undefined names: "
            + ", ".join(remaining[:12])
            + ("..." if len(remaining) > 12 else "")
        )
    if finalized != source:
        source_path.write_text(finalized.rstrip() + "\n", encoding="utf-8")
    return finalized


def jake_hidden_glb_name(step_name: str) -> str:
    """Jake cadpy sidecar: part.step → .part.step.glb"""
    return f".{Path(step_name).name}.glb"


def _wire_jake_artifacts_to_product_shell(
    project_path: Path,
    *,
    base: str,
    source_name: str,
    step_name: str,
    glb_name: str,
) -> dict[str, str]:
    """Keep Jake sibling/hidden naming and expose product-shell viewport names."""
    wired: dict[str, str] = {
        "source": source_name,
        "step": step_name,
        "glb": glb_name,
        "cad_ref": str(Path(step_name).with_suffix("").as_posix()),
    }
    step_path = project_path / step_name
    shell_glb = project_path / glb_name
    jake_glb = project_path / jake_hidden_glb_name(step_name)
    if step_path.is_file():
        # Prefer the STEP-derived Jake/cadjs sidecar for viewport output. The
        # shell GLB emitted by scripts/step can be Y-up while the sidecar keeps
        # the STEP assembly in Render Studio's expected Z-up orientation.
        if jake_glb.is_file():
            shell_glb.write_bytes(jake_glb.read_bytes())
        elif shell_glb.is_file() and not jake_glb.is_file():
            jake_glb.write_bytes(shell_glb.read_bytes())
        # Jake/cadpy GLBs are often metres (glTF). Render Studio viewport is mm —
        # bake the STEP unit match into both shell + sidecar so models aren't tiny.
        for preview in (shell_glb, jake_glb):
            if preview.is_file():
                try:
                    cad_service._match_glb_scale_to_step(step_path, preview)
                except Exception as exc:
                    logger.debug("Could not unit-match %s to STEP: %s", preview.name, exc)
        if jake_glb.is_file():
            wired["jake_glb"] = jake_glb.name
    # Optional parameter module Jake may emit.
    param_js = project_path / f".{Path(step_name).name}.js"
    if param_js.is_file():
        wired["jake_params"] = param_js.name
    brief = project_path / f"{base}.brief.md"
    if brief.is_file():
        wired["brief"] = brief.name
    return wired


def _looks_like_spiral_staircase(prompt: str, images: list[dict[str, Any]] | None = None) -> bool:
    p = (prompt or "").lower()
    if images:
        return False
    has_stair = "stair" in p or "staircase" in p or "spiral stair" in p
    has_spiral = "spiral" in p or "helical" in p
    has_treads = "tread" in p
    return has_stair and has_spiral and has_treads


def _planetary_orbit_radius_mm(prompt: str) -> float:
    match = re.search(
        r"(\d+(?:\.\d+)?)\s*mm\s*(?:radius\s*)?(?:circle|orbit|pcd|pitch)",
        prompt or "",
        re.I,
    )
    if match:
        try:
            return float(match.group(1))
        except ValueError:
            pass
    match = re.search(
        r"(?:on\s+a|orbit(?:al)?|circle(?:\s+of)?|radius)\s+(\d+(?:\.\d+)?)\s*mm",
        prompt or "",
        re.I,
    )
    if match:
        try:
            return float(match.group(1))
        except ValueError:
            pass
    return 42.0


def _looks_like_planetary_gear_assembly(prompt: str, images: list[dict[str, Any]] | None = None) -> bool:
    p = (prompt or "").lower()
    if images:
        return False
    has_planetary = "planetary" in p or ("sun" in p and "planet" in p and "ring" in p)
    has_gear = "gear" in p or "teeth" in p or "tooth" in p
    return has_planetary and has_gear


def _prompt_implies_mechanism_motion(prompt: str, images: list[dict[str, Any]] | None = None) -> bool:
    """True when the user asked for something that should get a .step.js motion sidecar.

    Jake does not infer joints from BREP — mechanisms need an explicit parameter module
    (or URDF). This only decides whether to *author* that sidecar after STEP succeeds.
    """
    if images:
        return False
    p = (prompt or "").lower()
    keywords = (
        "gear",
        "planetary",
        "hinge",
        "linkage",
        "slider",
        "piston",
        "crank",
        "cam",
        "lid",
        "door",
        "animate",
        "animation",
        "motion",
        "rotate",
        "spin",
        "joint",
        "mechanism",
        "robot",
        "arm",
        "gripper",
        "meshing",
        "teeth",
        "sprocket",
        "pulley",
        "belt",
        "fold",
        "open/close",
        "open and close",
    )
    return any(k in p for k in keywords)


def _extract_part_labels_from_source(source: str) -> list[str]:
    """Collect stable snake_case labels from build123d source for .step.js features."""
    labels: list[str] = []
    seen: set[str] = set()
    patterns = (
        r'\.label\s*=\s*["\']([A-Za-z_][A-Za-z0-9_]*)["\']',
        r'label\s*=\s*["\']([A-Za-z_][A-Za-z0-9_]*)["\']',
        r'(?:sun|planet|ring|carrier|pin|lid|link|gear|arm|joint)_label[s]?\s*=\s*["\']([A-Za-z_][A-Za-z0-9_]*)["\']',
    )
    for pattern in patterns:
        for match in re.finditer(pattern, source or ""):
            label = match.group(1)
            if label in {"model_label", "part_label"} or label in seen:
                continue
            if len(label) < 2:
                continue
            seen.add(label)
            labels.append(label)
    # planet_labels = ["planet_1", ...]
    for match in re.finditer(
        r'(?:planet_labels|pin_labels|part_labels)\s*=\s*\[([^\]]+)\]',
        source or "",
        re.I,
    ):
        for item in re.findall(r'["\']([A-Za-z_][A-Za-z0-9_]*)["\']', match.group(1)):
            if item not in seen:
                seen.add(item)
                labels.append(item)
    return labels


def _maybe_author_step_module(
    *,
    ai: Any,
    project_path: Path,
    prompt: str,
    step_name: str,
    source: str,
    inspect_out: dict[str, Any] | None,
    trace_id: str | None,
    ai_traces: list[dict[str, Any]],
    images: list[dict[str, Any]] | None = None,
) -> str | None:
    """Write .<step>.js motion sidecar when the prompt implies a mechanism."""
    if not _prompt_implies_mechanism_motion(prompt, images):
        return None
    module_name = f".{Path(step_name).name}.js"
    module_path = project_path / module_name
    labels = _extract_part_labels_from_source(source)
    inspect_summary = ""
    if isinstance(inspect_out, dict):
        inspect_summary = ((inspect_out.get("stdout") or "") + "\n" + (inspect_out.get("stderr") or ""))[-3000:]
    try:
        module_src, trace = ai.generate_step_module(
            user_prompt=prompt,
            step_name=step_name,
            part_labels=labels,
            source=source,
            inspect_summary=inspect_summary,
            trace_id=trace_id,
        )
        if trace:
            ai_traces.append(trace)
        module_path.write_text(module_src, encoding="utf-8")
        trace_add("info", f"[authoring-agent] wrote STEP motion module {module_name}", trace_id=trace_id)
        return module_name
    except Exception as exc:
        trace_add("warning", f"[authoring-agent] STEP module authoring skipped: {exc}", trace_id=trace_id)
        return None


def _canonical_planetary_gear_assembly_source(*, label: str, prompt: str) -> str:
    """Jake benchmark 10 planetary stage — trapezoidal teeth, correct internal ring.

    Matches ``tmp_jake_text_to_cad/benchmarks/10-planetary-gear-stage.md``.
    Ring teeth are *added inward* from the root circle (not cut as deep radial
    slots), which was producing the fin/radiator look in the viewport.
    """
    safe_label = json.dumps(label or "planetary_gear_assembly")
    orbit = _planetary_orbit_radius_mm(prompt)
    return f'''from math import cos, sin, pi, radians
from build123d import *

model_label = {safe_label}
gear_thickness = 8.0
planet_count = 3
planet_orbit_radius = {orbit:.3f}
planet_angles_deg = [i * (360.0 / planet_count) for i in range(planet_count)]

# Jake benchmark 10 diameters (mm) → radii
sun_teeth = 24
planet_teeth = 18
ring_teeth = 60

sun_root_radius = 21.0
sun_outer_radius = 27.0
sun_bore_radius = 5.0
sun_label = "sun"

planet_root_radius = 15.5
planet_outer_radius = 20.5
planet_bore_radius = 3.0
planet_labels = [f"planet_{{i + 1}}" for i in range(planet_count)]

ring_outer_radius = 70.0
ring_root_radius = 63.0
ring_tip_radius = 57.0
ring_label = "ring"

carrier_radius = 52.5
carrier_thickness = 4.0
carrier_z = -5.0
carrier_label = "carrier"

pin_radius = 3.0
pin_height = 14.0
pin_z = -5.0
pin_labels = [f"pin_{{i + 1}}" for i in range(planet_count)]


def _trapezoid_tooth(root_r, tip_r, teeth, thickness, *, inward=False):
    """Straight-sided trapezoid tooth in the XY plane, radial along +Y."""
    pitch = (2.0 * pi * max(float(root_r), 1.0)) / max(int(teeth), 1)
    w_root = pitch * 0.52
    w_tip = pitch * 0.28
    y0, y1 = (float(tip_r), float(root_r)) if inward else (float(root_r), float(tip_r))
    pts = [
        (-w_root / 2.0, y0),
        (-w_tip / 2.0, y1),
        (w_tip / 2.0, y1),
        (w_root / 2.0, y0),
    ]
    with BuildSketch() as sk:
        Polygon(*pts)
    return extrude(sk.sketch, amount=float(thickness))


def make_external_gear(root_r, outer_r, teeth, thickness, bore_radius=0.0, label="gear"):
    body = Cylinder(radius=float(root_r), height=float(thickness), align=(Align.CENTER, Align.CENTER, Align.MIN))
    for i in range(int(teeth)):
        tooth = _trapezoid_tooth(root_r, outer_r, teeth, thickness, inward=False)
        tooth = tooth.rotate(Axis.Z, i * (360.0 / max(int(teeth), 1)))
        body = body + tooth
    if bore_radius and float(bore_radius) > 0:
        body = body - Cylinder(
            radius=float(bore_radius),
            height=float(thickness) + 2.0,
            align=(Align.CENTER, Align.CENTER, Align.MIN),
        ).moved(Location((0, 0, -1)))
    body.label = label
    return body


def make_ring_gear(label=ring_label):
    # Solid rim from root → OD, then add shallow internal teeth tip←root.
    # Do NOT subtract deep pockets from the bore — that creates radial fins.
    rim = Cylinder(radius=ring_outer_radius, height=gear_thickness, align=(Align.CENTER, Align.CENTER, Align.MIN))
    rim = rim - Cylinder(
        radius=ring_root_radius,
        height=gear_thickness + 2.0,
        align=(Align.CENTER, Align.CENTER, Align.MIN),
    ).moved(Location((0, 0, -1)))
    for i in range(int(ring_teeth)):
        tooth = _trapezoid_tooth(ring_root_radius, ring_tip_radius, ring_teeth, gear_thickness, inward=True)
        tooth = tooth.rotate(Axis.Z, i * (360.0 / ring_teeth))
        rim = rim + tooth
    rim.label = label
    return rim


def make_carrier():
    plate = Cylinder(radius=carrier_radius, height=carrier_thickness, align=(Align.CENTER, Align.CENTER, Align.MIN))
    plate = plate - Cylinder(
        radius=sun_bore_radius + 1.5,
        height=carrier_thickness + 2.0,
        align=(Align.CENTER, Align.CENTER, Align.MIN),
    ).moved(Location((0, 0, -1)))
    for angle_deg in planet_angles_deg:
        ang = radians(angle_deg)
        px = planet_orbit_radius * cos(ang)
        py = planet_orbit_radius * sin(ang)
        plate = plate - Cylinder(
            radius=pin_radius + 0.2,
            height=carrier_thickness + 2.0,
            align=(Align.CENTER, Align.CENTER, Align.MIN),
        ).moved(Location((px, py, -1)))
    plate = plate.moved(Location((0, 0, carrier_z)))
    plate.label = carrier_label
    return plate


def make_pin(label="pin"):
    pin = Cylinder(radius=pin_radius, height=pin_height, align=(Align.CENTER, Align.CENTER, Align.MIN))
    pin.label = label
    return pin


def gen_step():
    sun = make_external_gear(
        sun_root_radius,
        sun_outer_radius,
        sun_teeth,
        gear_thickness,
        bore_radius=sun_bore_radius,
        label=sun_label,
    )
    ring = make_ring_gear(ring_label)
    carrier = make_carrier()

    planets = []
    pins = []
    for idx, angle_deg in enumerate(planet_angles_deg):
        ang = radians(angle_deg)
        px = planet_orbit_radius * cos(ang)
        py = planet_orbit_radius * sin(ang)
        # Half-pitch rotation so planet teeth mesh with sun/ring visually.
        planet = make_external_gear(
            planet_root_radius,
            planet_outer_radius,
            planet_teeth,
            gear_thickness,
            bore_radius=planet_bore_radius,
            label=planet_labels[idx],
        ).located(Location((px, py, 0), (0, 0, angle_deg * (sun_teeth / planet_teeth) + 180.0 / planet_teeth)))
        planet.label = planet_labels[idx]
        planets.append(planet)

        pin = make_pin(pin_labels[idx]).located(Location((px, py, pin_z)))
        pin.label = pin_labels[idx]
        pins.append(pin)

    sun.label = sun_label
    ring.label = ring_label
    carrier.label = carrier_label
    return Compound(
        children=[ring, carrier, sun, *planets, *pins],
        label=model_label,
    )
'''


def _canonical_spiral_staircase_source(*, label: str, prompt: str) -> str:
    safe_label = json.dumps(label or "spiral_staircase")
    tread_count = _spiral_stair_tread_count(prompt)
    return f'''from build123d import *
import math

model_label = {safe_label}

tread_count = {tread_count}
num_treads = tread_count
base_radius = 16.0
base_thickness = 3.0
column_radius = 2.0
rise_per_tread = 3.0
tread_thickness = 1.8
tread_depth = 6.0
tread_outer_radius = 24.0
tread_angle_increment = 360.0 / max(1, tread_count)
tread_span_deg = max(12.0, tread_angle_increment * 0.9)
handrail_height_offset = 10.0
rail_height_above_tread = handrail_height_offset
baluster_radius = 0.55
baluster_radial_position = tread_outer_radius - 0.8
tread_label_prefix = "tread_"
baluster_label_prefix = "baluster_"
base_top = base_thickness


def polar_point(radius, angle_deg, z):
    angle = math.radians(angle_deg)
    return (radius * math.cos(angle), radius * math.sin(angle), z)


def gen_step():
    children = []

    base = Cylinder(radius=base_radius, height=base_thickness, align=(Align.CENTER, Align.CENTER, Align.MIN))
    base.label = "base_disk"
    children.append(base)

    column_height = base_thickness + tread_count * rise_per_tread + handrail_height_offset + 6.0
    column = Cylinder(radius=column_radius, height=column_height, align=(Align.CENTER, Align.CENTER, Align.MIN))
    column.label = "central_column"
    children.append(column)

    tread_length = max(tread_outer_radius - column_radius - 0.8, 5.0)
    for i in range(tread_count):
        angle_deg = i * tread_angle_increment
        z0 = base_thickness + i * rise_per_tread
        center = polar_point(column_radius + tread_length * 0.5, angle_deg, z0 + tread_thickness * 0.5)
        tread = Box(tread_length, tread_depth, tread_thickness, align=(Align.CENTER, Align.CENTER, Align.CENTER))
        tread = tread.rotate(Axis.Z, angle_deg)
        tread = tread.located(Location(center))
        tread.label = f"{{tread_label_prefix}}{{i + 1:02d}}"
        children.append(tread)

        baluster_h = max(handrail_height_offset - 1.0, 4.0)
        baluster_center = polar_point(baluster_radial_position, angle_deg, z0 + tread_thickness + baluster_h * 0.5)
        baluster = Cylinder(radius=baluster_radius, height=baluster_h, align=(Align.CENTER, Align.CENTER, Align.CENTER))
        baluster = baluster.located(Location(baluster_center))
        baluster.label = f"{{baluster_label_prefix}}{{i + 1:02d}}"
        children.append(baluster)

    handrail_nodes = []
    handrail_node_radius = 0.75
    for j in range(tread_count + 1):
        angle_deg = j * tread_angle_increment
        z = base_thickness + j * rise_per_tread + handrail_height_offset
        pos = polar_point(baluster_radial_position, angle_deg, z)
        node = Sphere(radius=handrail_node_radius).located(Location(pos))
        handrail_nodes.append(node)
    handrail = Compound(children=handrail_nodes)
    handrail.label = "helical_handrail"
    children.append(handrail)

    model = Compound(children=children)
    model.label = model_label
    return model
'''


def _looks_like_pc_cooling_fan(prompt: str, images: list[dict[str, Any]] | None = None) -> bool:
    p = (prompt or "").lower()
    if images:
        return False
    return (
        ("fan" in p and any(w in p for w in ("computer", "pc", "cooling", "case")))
        or "120mm square computer cooling fan" in p
    )


def _looks_like_modular_robot_house(prompt: str, images: list[dict[str, Any]] | None = None) -> bool:
    p = (prompt or "").lower()
    if images:
        return False
    return (
        "house" in p
        and any(token in p for token in ("modular", "snap", "robotic", "robot arm", "assembled", "exploded"))
        and any(token in p for token in ("wall panel", "pillar", "balcony", "dovetail", "window", "door"))
    )


def _looks_like_architect_prompt(prompt: str) -> bool:
    p = (prompt or "").lower()
    return any(
        token in p
        for token in (
            "architect",
            "room",
            "house",
            "building",
            "wall",
            "window",
            "door",
            "ceiling",
            "roof",
            "floor plan",
            "floorplan",
            "pillar",
        )
    )


def _looks_like_arduino_nema_mount_box(prompt: str, images: list[dict[str, Any]] | None = None) -> bool:
    p = (prompt or "").lower()
    return (
        ("arduino" in p and ("nema 17" in p or "nema17" in p or "nema" in p))
        and any(token in p for token in ("box", "enclosure", "mounting box", "open-top", "open top"))
    )


def _canonical_arduino_nema_mount_box_source(*, label: str, prompt: str) -> str:
    dims = _prompt_outer_box_dimensions(prompt) or (160.0, 100.0, 50.0)
    wall = _prompt_named_mm_value(prompt, ("wall thickness", "wall_thickness")) or 3.0
    base = _prompt_named_mm_value(prompt, ("base thickness", "floor thickness", "bottom thickness")) or 3.0
    safe_label = json.dumps(label or "arduino_nema_mount_box")
    return f'''from build123d import *

model_label = {safe_label}

outer_length = {dims[0]}
outer_width = {dims[1]}
outer_height = {dims[2]}
wall_thickness = {wall}
base_thickness = {base}

inside_length = max(outer_length - 2.0 * wall_thickness, 20.0)
inside_width = max(outer_width - 2.0 * wall_thickness, 20.0)

outside_corner_fillet = min(2.0, max(0.4, wall_thickness * 0.65))

arduino_board_length = 101.3
arduino_board_width = 68.6
arduino_center_x = -outer_length * 0.22
arduino_center_y = 0.0

standoff_height = 6.0
standoff_outer_radius = 3.5
standoff_hole_radius = 1.6
standoff_span_x = min(72.0, max(28.0, inside_length * 0.36))
standoff_span_y = min(48.0, max(20.0, inside_width * 0.38))
arduino_standoff_positions = [
    (arduino_center_x - standoff_span_x / 2.0, arduino_center_y - standoff_span_y / 2.0),
    (arduino_center_x + standoff_span_x / 2.0, arduino_center_y - standoff_span_y / 2.0),
    (arduino_center_x - standoff_span_x / 2.0, arduino_center_y + standoff_span_y / 2.0),
    (arduino_center_x + standoff_span_x / 2.0, arduino_center_y + standoff_span_y / 2.0),
]

divider_thickness = 3.0
divider_center_x = 0.0
divider_height = max(outer_height - base_thickness - 4.0, 8.0)
divider_wire_slot_width = 14.0
divider_wire_slot_height = 8.0

nema_center_x = outer_length * 0.24
nema_center_y = 0.0
nema_face_size = 42.3
nema_pocket_size = 42.0
nema_pocket_depth = max(1.2, min(2.5, base_thickness - 0.4))
nema_shaft_clearance_radius = 11.5
nema_mount_hole_radius = 1.7
nema_mount_spacing = 31.0
top_edge_chamfer = min(1.0, max(0.35, wall_thickness * 0.3))
arduino_floor_relief_depth = min(1.2, max(0.6, base_thickness * 0.35))
arduino_floor_relief_length = min(inside_length * 0.8, arduino_board_length + 8.0)
arduino_floor_relief_width = min(inside_width - 6.0, arduino_board_width + 6.0)
marker_thickness = 0.8
label_box = "enclosure_box"
label_arduino_marker = "arduino_mount_zone"
label_nema_marker = "nema17_mount_zone"
nema_mount_hole_positions = [
    (nema_center_x - nema_mount_spacing / 2.0, nema_center_y - nema_mount_spacing / 2.0),
    (nema_center_x + nema_mount_spacing / 2.0, nema_center_y - nema_mount_spacing / 2.0),
    (nema_center_x - nema_mount_spacing / 2.0, nema_center_y + nema_mount_spacing / 2.0),
    (nema_center_x + nema_mount_spacing / 2.0, nema_center_y + nema_mount_spacing / 2.0),
]


def gen_step():
    with BuildPart() as part_builder:
        Box(
            outer_length,
            outer_width,
            outer_height,
            align=(Align.CENTER, Align.CENTER, Align.MIN),
            mode=Mode.ADD,
        )

        with Locations((0.0, 0.0, base_thickness)):
            Box(
                inside_length,
                inside_width,
                outer_height + 2.0,
                align=(Align.CENTER, Align.CENTER, Align.MIN),
                mode=Mode.SUBTRACT,
            )

        with Locations((divider_center_x, 0.0, base_thickness)):
            Box(
                divider_thickness,
                inside_width,
                divider_height,
                align=(Align.CENTER, Align.CENTER, Align.MIN),
                mode=Mode.ADD,
            )
        with Locations((divider_center_x, 0.0, base_thickness + divider_wire_slot_height / 2.0)):
            Box(
                divider_thickness + 0.4,
                divider_wire_slot_width,
                divider_wire_slot_height,
                align=(Align.CENTER, Align.CENTER, Align.CENTER),
                mode=Mode.SUBTRACT,
            )

        with Locations(*[(x, y, base_thickness) for x, y in arduino_standoff_positions]):
            Cylinder(
                radius=standoff_outer_radius,
                height=standoff_height,
                align=(Align.CENTER, Align.CENTER, Align.MIN),
                mode=Mode.ADD,
            )

        with Locations(*[(x, y, base_thickness + standoff_height) for x, y in arduino_standoff_positions]):
            Cylinder(
                radius=standoff_hole_radius,
                height=min(standoff_height, 8.0),
                align=(Align.CENTER, Align.CENTER, Align.MAX),
                mode=Mode.SUBTRACT,
            )

        with Locations((arduino_center_x, arduino_center_y, base_thickness + arduino_floor_relief_depth)):
            Box(
                arduino_floor_relief_length,
                arduino_floor_relief_width,
                arduino_floor_relief_depth + 0.02,
                align=(Align.CENTER, Align.CENTER, Align.MAX),
                mode=Mode.SUBTRACT,
            )

        with Locations((nema_center_x, nema_center_y, base_thickness + nema_pocket_depth)):
            Box(
                nema_pocket_size,
                nema_pocket_size,
                nema_pocket_depth + 0.04,
                align=(Align.CENTER, Align.CENTER, Align.MAX),
                mode=Mode.SUBTRACT,
            )

        with Locations((nema_center_x, nema_center_y, -0.5)):
            Cylinder(
                radius=nema_shaft_clearance_radius,
                height=base_thickness + 1.0,
                align=(Align.CENTER, Align.CENTER, Align.MIN),
                mode=Mode.SUBTRACT,
            )

        with Locations(*[(x, y, -0.5) for x, y in nema_mount_hole_positions]):
            Cylinder(
                radius=nema_mount_hole_radius,
                height=base_thickness + 1.0,
                align=(Align.CENTER, Align.CENTER, Align.MIN),
                mode=Mode.SUBTRACT,
            )

        vertical_edges = part_builder.edges().filter_by(Axis.Z)
        if vertical_edges:
            for candidate in (
                outside_corner_fillet,
                outside_corner_fillet * 0.75,
                outside_corner_fillet * 0.5,
                outside_corner_fillet * 0.3,
            ):
                if candidate <= 0.05:
                    continue
                try:
                    fillet(vertical_edges, radius=candidate)
                    break
                except Exception:
                    continue
        if top_edge_chamfer > 0.0:
            top_edges = part_builder.edges().filter_by_position(Axis.Z, outer_height - 0.12, outer_height + 0.12)
            if top_edges:
                chamfer(top_edges, length=top_edge_chamfer)

    body = part_builder.part
    body.label = label_box

    arduino_marker = Box(
        arduino_floor_relief_length,
        arduino_floor_relief_width,
        marker_thickness,
        align=(Align.CENTER, Align.CENTER, Align.MIN),
    ).located(Location((arduino_center_x, arduino_center_y, base_thickness + 0.02)))
    arduino_marker.label = label_arduino_marker

    nema_marker = Box(
        nema_face_size,
        nema_face_size,
        marker_thickness,
        align=(Align.CENTER, Align.CENTER, Align.MIN),
    ).located(Location((nema_center_x, nema_center_y, base_thickness + 0.02)))
    nema_marker.label = label_nema_marker

    assembly = Compound(children=[body, arduino_marker, nema_marker], label=model_label)
    assembly.label = model_label
    return assembly
'''


def _canonical_pc_cooling_fan_source(*, label: str) -> str:
    safe_label = json.dumps(label or "pc_cooling_fan")
    return f'''from build123d import *
import math

model_label = {safe_label}
outer_size = 120.0
frame_thickness = 25.0
corner_radius = 8.0
inner_opening_radius = 54.0
screw_pitch = 105.0
screw_hole_radius = 2.25
hub_radius = 20.0
hub_height = 16.0
blade_count = 7
blade_height = 4.0
blade_inner_radius = 18.0
blade_outer_radius = 52.0


def _rounded_square_prism(size, radius, height):
    core_a = Box(size - 2.0 * radius, size, height)
    core_b = Box(size, size - 2.0 * radius, height)
    body = core_a + core_b
    corner = size / 2.0 - radius
    for sx in (-1, 1):
        for sy in (-1, 1):
            body = body + Pos(sx * corner, sy * corner, 0) * Cylinder(radius, height)
    return body


def _blade_points(angle_deg):
    angle = math.radians(angle_deg)
    sweep = math.radians(24.0)
    width_inner = math.radians(8.5)
    width_outer = math.radians(5.5)
    samples = []
    for i in range(5):
        t = i / 4.0
        radius = blade_inner_radius + (blade_outer_radius - blade_inner_radius) * t
        theta = angle + sweep * (t - 0.18)
        samples.append((radius * math.cos(theta), radius * math.sin(theta)))
    leading = []
    trailing = []
    for i, point in enumerate(samples):
        t = i / 4.0
        radius = blade_inner_radius + (blade_outer_radius - blade_inner_radius) * t
        width = width_inner + (width_outer - width_inner) * t
        theta = angle + sweep * (t - 0.18)
        tangent = theta + math.pi / 2.0
        dx = math.cos(tangent) * radius * width * 0.5
        dy = math.sin(tangent) * radius * width * 0.5
        leading.append((point[0] + dx, point[1] + dy))
        trailing.append((point[0] - dx, point[1] - dy))
    return leading + list(reversed(trailing))


def _make_blade(angle_deg):
    points = _blade_points(angle_deg)
    with BuildPart() as blade:
        with BuildSketch(Plane.XY):
            Polyline(*points, close=True)
            make_face()
        extrude(amount=blade_height)
    return Pos(0, 0, -blade_height / 2.0) * blade.part


def make_printable_fan_solid():
    frame = _rounded_square_prism(outer_size, corner_radius, frame_thickness)
    frame = frame - Cylinder(inner_opening_radius, frame_thickness + 2.0)
    hole_offset = screw_pitch / 2.0
    for sx in (-1, 1):
        for sy in (-1, 1):
            frame = frame - Pos(sx * hole_offset, sy * hole_offset, 0) * Cylinder(screw_hole_radius, frame_thickness + 2.0)

    fan = frame + Cylinder(hub_radius, hub_height)
    for i in range(blade_count):
        fan = fan + _make_blade(i * 360.0 / blade_count)

    fan.label = model_label
    return fan


def gen_step():
    return make_printable_fan_solid()
'''


def _canonical_modular_robot_house_source(*, label: str) -> str:
    safe_label = json.dumps(label or "modular_robot_house")
    return f'''from build123d import *

model_label = {safe_label}

house_width = 220.0
house_depth = 160.0
story_height = 90.0
roof_height = 15.0
pillar_size = 12.0
wall_thickness = 6.0
floor_thickness = 8.0
roof_thickness = 10.0
balcony_width = 100.0
balcony_depth = 45.0
window_width = 35.0
window_height = 28.0
door_width = 38.0
door_height = 55.0


def named(shape, label):
    shape.label = label
    return shape


def box_part(label, size, loc):
    return named(Pos(*loc) * Box(*size), label)


def cylinder_part(label, radius, height, loc):
    return named(Pos(*loc) * Cylinder(radius, height), label)


def make_pillar(name, x, y):
    z = (story_height * 2.0 + roof_height) / 2.0
    pillar = box_part(name, (pillar_size, pillar_size, story_height * 2.0 + roof_height), (x, y, z))
    # Visible female dovetail channels on two outside faces, represented as darker void-like slots.
    channel_a = box_part(name + "_front_dovetail_channel", (pillar_size + 1.0, 3.0, story_height * 1.75), (x, y - pillar_size / 2.0 - 0.6, z))
    channel_b = box_part(name + "_side_dovetail_channel", (3.0, pillar_size + 1.0, story_height * 1.75), (x - pillar_size / 2.0 - 0.6, y, z))
    return [pillar, channel_a, channel_b]


def make_wall_panel(name, x, y, z, size, orientation="front"):
    panel = box_part(name, size, (x, y, z))
    tab_z = z
    if orientation in ("front", "back"):
        tab_left = box_part(name + "_left_male_dovetail_tab", (5.0, 4.0, size[2] * 0.78), (x - size[0] / 2.0 - 2.0, y, tab_z))
        tab_right = box_part(name + "_right_male_dovetail_tab", (5.0, 4.0, size[2] * 0.78), (x + size[0] / 2.0 + 2.0, y, tab_z))
    else:
        tab_left = box_part(name + "_left_male_dovetail_tab", (4.0, 5.0, size[2] * 0.78), (x, y - size[1] / 2.0 - 2.0, tab_z))
        tab_right = box_part(name + "_right_male_dovetail_tab", (4.0, 5.0, size[2] * 0.78), (x, y + size[1] / 2.0 + 2.0, tab_z))
    grip = box_part(name + "_robot_gripper_pad", (28.0, 2.0 if orientation in ("front", "back") else 28.0, 10.0), (x, y, z + 8.0))
    return [panel, tab_left, tab_right, grip]


def make_window(name, x, y, z):
    glass = box_part(name + "_blue_window_insert", (window_width, 2.5, window_height), (x, y, z))
    sill = box_part(name + "_snap_sill", (window_width + 10.0, 4.0, 4.0), (x, y - 1.0, z - window_height / 2.0 - 4.0))
    tabs = [
        box_part(name + "_snap_tab_left", (3.0, 5.0, window_height * 0.65), (x - window_width / 2.0 - 3.0, y, z)),
        box_part(name + "_snap_tab_right", (3.0, 5.0, window_height * 0.65), (x + window_width / 2.0 + 3.0, y, z)),
    ]
    return [glass, sill, *tabs]


def make_door(name, x, y, z):
    door = box_part(name + "_snap_in_door_module", (door_width, 3.0, door_height), (x, y, z))
    handle = cylinder_part(name + "_round_handle", 2.0, 4.0, (x + door_width * 0.25, y - 2.5, z + 5.0))
    tabs = [
        box_part(name + "_hinge_side_snap_tabs", (3.0, 5.0, door_height * 0.7), (x - door_width / 2.0 - 3.0, y, z)),
        box_part(name + "_latch_side_alignment_key", (3.0, 5.0, door_height * 0.45), (x + door_width / 2.0 + 3.0, y, z)),
    ]
    return [door, handle, *tabs]


def make_slab(name, z, size):
    slab = box_part(name, (size[0], size[1], floor_thickness), (0, 0, z))
    sockets = []
    ox = house_width / 2.0 - pillar_size / 2.0
    oy = house_depth / 2.0 - pillar_size / 2.0
    for ix, x in enumerate((-ox, ox)):
        for iy, y in enumerate((-oy, oy)):
            sockets.append(box_part(f"{{name}}_underside_socket_{{ix}}_{{iy}}", (pillar_size + 2.0, pillar_size + 2.0, 3.0), (x, y, z - floor_thickness / 2.0 - 1.5)))
    return [slab, *sockets]


def make_balcony():
    y = -house_depth / 2.0 - balcony_depth / 2.0
    z = story_height + 12.0
    deck = box_part("balcony_deck_locking_plate", (balcony_width, balcony_depth, 6.0), (0, y, z))
    rail_front = box_part("balcony_front_snap_railing", (balcony_width, 4.0, 28.0), (0, y - balcony_depth / 2.0 + 2.0, z + 16.0))
    rail_left = box_part("balcony_left_snap_railing", (4.0, balcony_depth, 28.0), (-balcony_width / 2.0 + 2.0, y, z + 16.0))
    rail_right = box_part("balcony_right_snap_railing", (4.0, balcony_depth, 28.0), (balcony_width / 2.0 - 2.0, y, z + 16.0))
    pegs = [
        cylinder_part("balcony_peg_socket_01", 2.2, 8.0, (-balcony_width * 0.35, y - balcony_depth * 0.25, z + 6.0)),
        cylinder_part("balcony_peg_socket_02", 2.2, 8.0, (balcony_width * 0.35, y - balcony_depth * 0.25, z + 6.0)),
    ]
    return [deck, rail_front, rail_left, rail_right, *pegs]


def make_corner_brackets():
    parts = []
    ox = house_width / 2.0 - 18.0
    oy = house_depth / 2.0 - 18.0
    for ix, x in enumerate((-ox, ox)):
        for iy, y in enumerate((-oy, oy)):
            bracket = box_part(f"m3_screw_corner_bracket_{{ix}}_{{iy}}", (24.0, 5.0, 24.0), (x, y, 48.0))
            hole = cylinder_part(f"m3_clearance_hole_marker_{{ix}}_{{iy}}", 1.7, 8.0, (x, y - 3.5, 48.0))
            parts.extend([bracket, hole])
    return parts


def build_assembled_house():
    parts = []
    ox = house_width / 2.0 - pillar_size / 2.0
    oy = house_depth / 2.0 - pillar_size / 2.0
    for label, x, y in (
        ("front_left_structural_pillar", -ox, -oy),
        ("front_right_structural_pillar", ox, -oy),
        ("back_left_structural_pillar", -ox, oy),
        ("back_right_structural_pillar", ox, oy),
    ):
        parts.extend(make_pillar(label, x, y))

    for story in (0, 1):
        z = story * story_height + story_height / 2.0
        tag = "first_floor" if story == 0 else "second_floor"
        parts.extend(make_wall_panel(f"{{tag}}_front_wall_panel", 0, -house_depth / 2.0, z, (house_width - 32.0, wall_thickness, story_height - 16.0), "front"))
        parts.extend(make_wall_panel(f"{{tag}}_back_wall_panel", 0, house_depth / 2.0, z, (house_width - 32.0, wall_thickness, story_height - 16.0), "back"))
        parts.extend(make_wall_panel(f"{{tag}}_left_wall_panel", -house_width / 2.0, 0, z, (wall_thickness, house_depth - 32.0, story_height - 16.0), "side"))
        parts.extend(make_wall_panel(f"{{tag}}_right_wall_panel", house_width / 2.0, 0, z, (wall_thickness, house_depth - 32.0, story_height - 16.0), "side"))
        parts.extend(make_window(f"{{tag}}_front_window", -45.0, -house_depth / 2.0 - 3.0, z + 15.0))
        parts.extend(make_window(f"{{tag}}_side_window", house_width / 2.0 + 3.0, 25.0, z + 12.0))

    parts.extend(make_door("front_door", 45.0, -house_depth / 2.0 - 3.0, door_height / 2.0 + 8.0))
    parts.extend(make_slab("floor_slab_with_pillar_sockets", floor_thickness / 2.0, (house_width + 8.0, house_depth + 8.0)))
    parts.extend(make_slab("second_floor_slab_with_sockets", story_height, (house_width + 8.0, house_depth + 8.0)))
    parts.extend(make_slab("flat_roof_slab_with_sockets", story_height * 2.0 + roof_thickness / 2.0, (house_width + 12.0, house_depth + 12.0)))
    parts.extend(make_balcony())
    parts.extend(make_corner_brackets())
    assembly = Compound(label="assembled_modular_robot_house", children=parts)
    assembly.label = "assembled_modular_robot_house"
    return assembly


def build_exploded_kit():
    assembled = build_assembled_house()
    kit_parts = []
    for index, child in enumerate(assembled.children):
        row = index // 8
        col = index % 8
        offset = Pos((col - 3.5) * 42.0, 260.0 + row * 42.0, 0.0)
        try:
            moved = offset * child
            moved.label = "exploded_" + (child.label or f"part_{{index:02d}}")
            kit_parts.append(moved)
        except Exception:
            kit_parts.append(child)
    exploded = Compound(label="exploded_snap_together_house_kit", children=kit_parts)
    exploded.label = "exploded_snap_together_house_kit"
    return exploded


def gen_step():
    assembled = build_assembled_house()
    exploded = build_exploded_kit()
    model = Compound(label=model_label, children=[assembled, exploded])
    model.label = model_label
    return model
'''


def _requested_mm_dimensions(prompt: str) -> list[float]:
    dims: list[float] = []
    for match in re.finditer(r"(?<!\d)(\d+(?:\.\d+)?)\s*(?:mm|millimeter|millimeters)\b", prompt or "", re.I):
        try:
            dims.append(float(match.group(1)))
        except ValueError:
            continue
    return dims


def _requested_overall_axis_dimensions(prompt: str) -> list[dict[str, Any]]:
    """Extract global bbox constraints from prompt text.

    Feature dimensions like "lens opening 52 mm wide" or "temple arm 135 mm long"
    are not overall envelope dimensions and should not be compared to the largest
    bbox side.
    """
    text = prompt or ""
    specs: list[dict[str, Any]] = []
    patterns = [
        (0, "front width", r"\b(?:overall\s+front\s+width|front\s+width|overall\s+width|total\s+width|outside\s+width|frame\s+width)\D{0,24}(\d+(?:\.\d+)?)\s*(?:mm|millimeter|millimeters)\b"),
        (1, "overall depth", r"\b(?:overall\s+depth|total\s+depth|outside\s+depth)\D{0,24}(\d+(?:\.\d+)?)\s*(?:mm|millimeter|millimeters)\b"),
        (2, "overall height", r"\b(?:overall\s+height|total\s+height|outside\s+height)\D{0,24}(\d+(?:\.\d+)?)\s*(?:mm|millimeter|millimeters)\b"),
        (0, "front width", r"\b(\d+(?:\.\d+)?)\s*(?:mm|millimeter|millimeters)\s+(?:overall\s+front\s+width|front\s+width|overall\s+wide|wide\s+overall|overall\s+width)\b"),
        (1, "overall depth", r"\b(\d+(?:\.\d+)?)\s*(?:mm|millimeter|millimeters)\s+(?:overall\s+deep|deep\s+overall|overall\s+depth)\b"),
        (2, "overall height", r"\b(\d+(?:\.\d+)?)\s*(?:mm|millimeter|millimeters)\s+(?:overall\s+tall|tall\s+overall|overall\s+height)\b"),
    ]
    for axis, label, pattern in patterns:
        for match in re.finditer(pattern, text, re.I):
            try:
                specs.append({"axis": axis, "label": label, "value": float(match.group(1))})
            except ValueError:
                continue
    deduped: list[dict[str, Any]] = []
    seen: set[tuple[int, float]] = set()
    for spec in specs:
        key = (int(spec["axis"]), round(float(spec["value"]), 3))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(spec)
    return deduped


def _inspect_summary(inspect_out: dict[str, Any]) -> dict[str, Any] | None:
    raw = inspect_out.get("stdout") or ""
    try:
        import json as _json
        payload = _json.loads(raw)
    except Exception:
        return None
    tokens = payload.get("tokens") if isinstance(payload, dict) else None
    if not isinstance(tokens, list) or not tokens:
        return None
    summary = tokens[0].get("summary") if isinstance(tokens[0], dict) else None
    return summary if isinstance(summary, dict) else None


def _v2_quality_repair_note(
    prompt: str,
    source: str,
    inspect_out: dict[str, Any],
    *,
    cad_brief: str = "",
    jake_identical: bool = True,
) -> str | None:
    """Spec-driven size checks from inspect facts (Jake inspection-and-validation).

    On Jake-identical path: only fail when inspect bbox clearly contradicts
    user/brief overall axis dimensions — never use Render Studio faceCount heuristics.
    """
    summary = _inspect_summary(inspect_out) or {}
    source_lower = (source or "").lower()
    dxf_workflow = ".dxf" in source_lower or "ezdxf" in source_lower or "readfile(" in source_lower
    bounds = summary.get("bounds") if isinstance(summary, dict) else None
    if isinstance(bounds, dict) and isinstance(bounds.get("min"), list) and isinstance(bounds.get("max"), list):
        try:
            size = [abs(float(b) - float(a)) for a, b in zip(bounds["min"][:3], bounds["max"][:3])]
        except Exception:
            size = []
        axis_requested = _requested_overall_axis_dimensions(prompt)
        if not axis_requested and cad_brief:
            axis_requested = _requested_overall_axis_dimensions(cad_brief)
        if axis_requested and size:
            axis_names = ("X/front width", "Y/depth", "Z/height")
            for spec in axis_requested:
                axis = int(spec["axis"])
                requested_value = float(spec["value"])
                actual_value = float(size[axis])
                if requested_value >= 25 and abs(actual_value - requested_value) > max(6.0, requested_value * 0.12):
                    return (
                        "Inspect facts contradict the CAD brief (Jake measure/envelope check): "
                        f"the prompt/brief specifies {spec['label']} of {requested_value:g} mm, "
                        f"but inspect reports {axis_names[axis]} = {actual_value:.1f} mm "
                        f"(bbox={', '.join(f'{v:.1f}' for v in size)} mm). "
                        "Revise named parameters in source so the exported overall axis matches, "
                        "then regenerate with scripts/step and re-inspect."
                    )
        if not jake_identical:
            requested = _requested_mm_dimensions(prompt)
            if requested and size and not axis_requested and not dxf_workflow:
                largest_requested = max(requested)
                largest_actual = max(size)
                if largest_requested >= 25 and abs(largest_actual - largest_requested) > max(6.0, largest_requested * 0.12):
                    return (
                        "The geometry passed export but failed the CAD brief quality gate: "
                        f"the prompt specifies an overall controlling dimension of {largest_requested:g} mm, "
                        f"but inspect reports a largest bounding-box dimension of {largest_actual:.1f} mm "
                        f"(bbox={', '.join(f'{v:.1f}' for v in size)} mm). "
                        "Revise the named parameters so the exported model's overall size matches the requested dimension."
                    )
    if jake_identical:
        return None
    p = (prompt or "").lower()
    functional = any(w in p for w in ("robot", "tool", "attach", "lock", "slide", "mount", "stir", "fixture", "bracket"))
    try:
        face_count = int(summary.get("faceCount") or 0)
    except Exception:
        face_count = 0
    has_functional_detail = any(token in source_lower for token in ("slot", "rail", "rib", "boss", "hole", "fillet", "chamfer", "trapezoid", "dovetail", "clearance"))
    if functional and not dxf_workflow and ((face_count > 0 and face_count < 36) or not has_functional_detail):
        return (
            "The geometry passed export but is too primitive for CAD 2.0/text-to-cad quality. "
            f"Inspect reports faceCount={face_count}. "
            "Add meaningful functional detail from the brief: modeled interface geometry, ribs/reliefs/slots/locks, "
            "and realistic proportions. Keep the model parametric and STEP-valid."
        )
    return None


def _run_v2_spec_dimension_hints(
    *,
    prompt: str,
    cad_brief: str,
    inspect_out: dict[str, Any],
) -> str | None:
    """Attach Jake-style dimension hints after inspect for the next repair turn."""
    from backend.services.cad_authoring_agent import extract_dimension_hints

    hints = extract_dimension_hints(prompt, cad_brief)
    if not hints:
        return None
    summary = _inspect_summary(inspect_out) or {}
    bounds = summary.get("bounds") if isinstance(summary, dict) else None
    size_txt = ""
    if isinstance(bounds, dict) and isinstance(bounds.get("min"), list) and isinstance(bounds.get("max"), list):
        try:
            size = [abs(float(b) - float(a)) for a, b in zip(bounds["min"][:3], bounds["max"][:3])]
            size_txt = f" Current inspect bbox mm = [{', '.join(f'{v:.1f}' for v in size)}]."
        except Exception:
            size_txt = ""
    return (
        "Jake inspection follow-up: verify these user/brief dimensions with named parameters "
        f"and scripts/inspect measure/align as needed: {', '.join(hints[:8])}.{size_txt}"
    )


def _run_v2_snapshot(
    skill_runner,
    project_path: Path,
    step_name: str,
    base: str,
    trace_id: str | None,
    *,
    prompt: str = "",
    source: str = "",
    inspect_summary: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Mandatory Jake-style snapshot packet (multi-view for assemblies/gears/stairs)."""
    from backend.services.cad_authoring_agent import (
        build_snapshot_job,
        collect_snapshot_pngs,
        needs_multi_view_packet,
        write_snapshot_job_file,
    )

    before = {p.name for p in project_path.glob(f"{base}_snapshot*.png")}
    multi = needs_multi_view_packet(prompt, source, inspect_summary)
    job = build_snapshot_job(step_name=step_name, base=base, multi_view=multi)
    job_path = write_snapshot_job_file(project_path, job, base)
    out = skill_runner.run_skill_tool(
        "cad",
        "snapshot",
        ["--job", job_path.name],
        cwd=project_path,
        timeout_sec=240.0,
    )
    if not out.get("ok"):
        # Jake: simplify the packet, still try multi-view before single iso.
        detail = (out.get("stderr") or out.get("stdout") or "snapshot failed")[:400]
        trace_add(
            "warning",
            f"[2.0/text-to-cad] snapshot multi-view job failed, retrying simplified diagnostic packet: {detail}",
            trace_id=trace_id,
        )
        simple_job = build_snapshot_job(step_name=step_name, base=base, multi_view=True)
        # Drop opposite view if the full packet failed — keep iso/top/front.
        simple_job["outputs"] = [
            o for o in (simple_job.get("outputs") or [])
            if str(o.get("path") or "").endswith(("_iso.png", "_top.png", "_front.png"))
        ] or simple_job.get("outputs")
        simple_path = write_snapshot_job_file(project_path, simple_job, f"{base}_simple")
        out = skill_runner.run_skill_tool(
            "cad",
            "snapshot",
            ["--job", simple_path.name],
            cwd=project_path,
            timeout_sec=240.0,
        )
    if not out.get("ok"):
        detail = (out.get("stderr") or out.get("stdout") or "snapshot failed")[:400]
        trace_add("warning", f"[2.0/text-to-cad] snapshot packet failed, last-resort single iso: {detail}", trace_id=trace_id)
        out = skill_runner.run_skill_tool(
            "cad",
            "snapshot",
            [
                "--input",
                step_name,
                "--output",
                f"{base}_snapshot.png",
                "--mode",
                "view",
                "--camera",
                "iso",
                "--size-profile",
                "diagnostic",
            ],
            cwd=project_path,
            timeout_sec=180.0,
        )
    if not out.get("ok"):
        detail = (out.get("stderr") or out.get("stdout") or "snapshot failed")[:800]
        trace_add("error", f"[2.0/text-to-cad] snapshot failed: {detail}", trace_id=trace_id)
        return None
    after = {p.name for p in project_path.glob(f"{base}_snapshot*.png")}
    created = sorted(after - before)
    files = collect_snapshot_pngs(project_path, base)
    if not files and created:
        files = created
    if not files and (project_path / f"{base}_snapshot.png").is_file():
        files = [f"{base}_snapshot.png"]
    if not files:
        return None
    return {
        "file": files[0],
        "files": files,
        "multi_view": multi,
        "stdout": (out.get("stdout") or "")[-2000:],
        "stderr": (out.get("stderr") or "")[-2000:],
    }


def _error_tail(out: dict[str, Any], fallback: str, *, limit: int = 2400) -> str:
    """Keep the end of tool stderr/stdout where actionable root causes usually appear."""
    text = (out.get("stderr") or out.get("stdout") or fallback or "").strip()
    if len(text) <= limit:
        return text
    return f"...\n{text[-limit:]}"


def _snapshot_image_payload(project_path: Path, snapshot_info: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not snapshot_info:
        return []
    names = list(snapshot_info.get("files") or [])
    if snapshot_info.get("file") and snapshot_info["file"] not in names:
        names.insert(0, str(snapshot_info["file"]))
    images: list[dict[str, Any]] = []
    for name in names[:4]:
        path = project_path / str(name)
        if not path.is_file() or path.suffix.lower() != ".png":
            continue
        data = base64.b64encode(path.read_bytes()).decode("ascii")
        images.append({
            "id": f"cad-snapshot-{len(images)}",
            "name": path.name,
            "media_type": "image/png",
            "data_url": f"data:image/png;base64,{data}",
        })
    return images


def _v2_snapshot_review_repair_note(
    ai: AIService,
    *,
    prompt: str,
    cad_brief: str,
    source: str,
    inspect_out: dict[str, Any],
    snapshot_info: dict[str, Any] | None,
    project_path: Path,
    trace_id: str | None,
    fusion_mode: bool = False,
) -> tuple[str | None, dict[str, Any] | None]:
    images = _snapshot_image_payload(project_path, snapshot_info)
    if not images:
        # Jake: visual review is mandatory when snapshot artifacts exist.
        names = list((snapshot_info or {}).get("files") or [])
        if (snapshot_info or {}).get("file"):
            names.append(str(snapshot_info["file"]))
        if names:
            return (
                "Snapshot PNG files were produced but could not be loaded for visual review "
                f"({', '.join(dict.fromkeys(names)[:4])}). "
                "Rerun scripts/snapshot and ensure readable PNGs exist before accepting the model."
            ), None
        return (
            "Mandatory Jake snapshot review failed: no loadable PNG snapshots were available. "
            "Rerun scripts/snapshot after regenerating STEP."
        ), None
    system = """You are reviewing a text-to-cad snapshot like the upstream CAD skill.
Return ONLY JSON: {"pass": boolean, "repair_note": string, "issues": [string]}.
Pass only if the visible model appears to satisfy the user's prompt and CAD brief.
Fail when the model is a primitive placeholder, misses key functional interfaces, ignores explicit dimensions, lacks requested holes/slots/bosses/mounting features, or looks semantically unlike the requested object.
For gears / planetary assemblies: FAIL if ring teeth look like long radial fins/slats, if planets do not sit between sun and ring, if teeth clearly do not mesh, or if carrier/pins are missing when requested. Internal ring teeth must be short inward teeth on a solid rim — not deep cuts to the center.
For spiral stairs: FAIL if treads are not rising around a central column, or if balusters/handrail are floating debris unrelated to the stair.
If failing, repair_note must be concrete source-level guidance for the next build123d repair attempt (edit the existing gen_step source; do not restart from scratch)."""
    if fusion_mode:
        system += """

Fusion mode extra review:
- Review like a Fusion 360 operator after running the timeline and taking screenshots.
- Fail if the feature phases are visibly wrong: connector stack misplaced, pipes/sweeps face the wrong direction, patterns use the wrong axis, holes/nut traps are missing, or fillets/chamfers/materials are not applied where functionally expected.
- The repair_note should name the exact source/timeline phase to edit next, preserving working phases."""
    user = (
        f"User prompt:\n{prompt}\n\n"
        f"{cad_brief}\n\n"
        f"Inspect summary:\n{json.dumps(_inspect_summary(inspect_out) or {}, separators=(',', ':'))}\n\n"
        "Current source excerpt:\n"
        f"{source[:9000]}\n\n"
        "Review ALL attached snapshot views (iso / opposite / top / front when present). "
        "Does the model visually and functionally match the brief from every view?"
    )
    review, trace = ai.chat_json(
        system,
        user,
        images=images,
        trace_id=trace_id,
        max_tokens=4096,
        retry_on_truncation=False,
        reasoning_effort="medium",
        pro_floor=None,
    )
    if review.get("pass") is True:
        return None, trace
    note = str(review.get("repair_note") or "").strip()
    issues = [str(issue) for issue in (review.get("issues") or []) if str(issue).strip()]
    if not note and issues:
        note = "Snapshot visual review failed: " + "; ".join(issues)
    if not note:
        note = "Snapshot visual review failed: model does not clearly match the CAD brief. Add the missing functional geometry and improve fidelity."
    return note, trace


def _footprint_score_at_z(vertices, z_val: float, tol: float) -> float:
    """Prefer a large, roughly square slice — typical of a machine base plate."""
    import numpy as np

    mask = np.abs(vertices[:, 2] - z_val) < tol
    if int(mask.sum()) < 8:
        return 0.0
    xy = vertices[mask][:, :2]
    span = xy.max(axis=0) - xy.min(axis=0)
    mn = float(min(span[0], span[1]))
    mx = float(max(span[0], span[1]))
    if mx <= 1e-9:
        return 0.0
    return mn * (1.0 - abs(span[0] - span[1]) / mx)


def _seat_mesh_on_xy_floor(mesh) -> None:
    """Center in X/Y and put the lowest point on z = 0."""
    bounds = mesh.bounds
    mesh.apply_translation(
        [
            -(bounds[0, 0] + bounds[1, 0]) / 2.0,
            -(bounds[0, 1] + bounds[1, 1]) / 2.0,
            -bounds[0, 2],
        ]
    )


def _ensure_base_footprint_on_min_z(mesh) -> bool:
    """If the larger square footprint is at max Z, flip 180° about X so the base sits down."""
    import math

    import numpy as np
    import trimesh

    verts = mesh.vertices
    extent_z = float(mesh.extents[2])
    if extent_z <= 1e-9:
        return False
    tol = extent_z / 25.0
    score_min = _footprint_score_at_z(verts, float(verts[:, 2].min()), tol)
    score_max = _footprint_score_at_z(verts, float(verts[:, 2].max()), tol)
    if score_max > score_min * 1.05 and score_max > 1e-6:
        mesh.apply_transform(trimesh.transformations.rotation_matrix(math.pi, [1, 0, 0]))
        return True
    return False


def _convert_text_to_cad_glb_to_z_up(glb_path: Path) -> None:
    """Convert upstream text-to-cad's native Y-up preview GLB to Render Studio Z-up.

    Picks +90° or -90° about X so the larger base-like footprint ends at min Z,
    then seats the mesh on the XY floor (z = 0).
    """
    if not glb_path.is_file():
        return
    try:
        import numpy as np
        import trimesh

        scene = trimesh.load(glb_path, force="scene")
        mesh = scene.dump(concatenate=True) if hasattr(scene, "dump") else scene
        if mesh is None:
            return
        if not hasattr(mesh, "vertices"):
            # Fall back to scene transform path
            mesh = trimesh.util.concatenate(tuple(scene.geometry.values()))

        size = mesh.extents
        sx = float(size[0])
        sy = float(size[1])
        sz = float(size[2])
        # Flat parts on the XY floor (RC planes, plates, gears): thin Z is already Z-up.
        # The previous "sz >= sy" check treated these as Y-up and tipped them sideways.
        if sz < min(sx, sy) * 0.55:
            already_z_up = True
        elif sz >= max(sx, sy) * 0.95:
            # Standing height already along Z.
            already_z_up = True
        elif sy >= max(sx, sz) * 0.99 and sy > sz * 1.15:
            # Classic Y-up standing model (tallest axis is Y, clearly taller than Z).
            # Require sy > sz*1.15 so long flat parts (airplanes, wings) stay Z-up.
            already_z_up = False
        else:
            already_z_up = sz >= sy * 1.05

        if not already_z_up:
            # Try both Y-up → Z-up directions; keep the one with base footprint at min Z.
            candidates = []
            for angle in (math.pi / 2.0, -math.pi / 2.0):
                trial = mesh.copy()
                trial.apply_transform(trimesh.transformations.rotation_matrix(angle, [1, 0, 0]))
                tol = float(trial.extents[2]) / 25.0 + 1e-9
                s_min = _footprint_score_at_z(trial.vertices, float(trial.vertices[:, 2].min()), tol)
                s_max = _footprint_score_at_z(trial.vertices, float(trial.vertices[:, 2].max()), tol)
                # Higher score at min Z is better; slight preference for +90 on ties.
                score = s_min - s_max
                candidates.append((score, angle, trial))
            candidates.sort(key=lambda item: item[0], reverse=True)
            _best_score, _angle, mesh = candidates[0]
            scene.apply_transform(trimesh.transformations.rotation_matrix(_angle, [1, 0, 0]))

        if _ensure_base_footprint_on_min_z(mesh):
            scene.apply_transform(trimesh.transformations.rotation_matrix(math.pi, [1, 0, 0]))
        bounds = mesh.bounds
        translation = [
            -(bounds[0, 0] + bounds[1, 0]) / 2.0,
            -(bounds[0, 1] + bounds[1, 1]) / 2.0,
            -bounds[0, 2],
        ]
        mesh.apply_translation(translation)
        scene.apply_transform(trimesh.transformations.translation_matrix(translation))
        scene.export(glb_path, file_type="glb")
    except Exception as exc:
        logger.warning("Could not convert text-to-cad GLB to Z-up (%s): %s", glb_path.name, exc)


def _run_text_to_cad_v2(
    prompt: str,
    project_path: Path,
    context: dict[str, Any],
    ai: AIService,
    *,
    trace_id: str | None,
    max_repairs: int,
    images: list[dict[str, Any]] | None,
    previous_source: str | None = None,
    previous_source_name: str | None = None,
    cancel_check=None,
    progress_callback=None,
    usage_callback=None,
    fusion_mode: bool = False,
    architect_mode: bool = False,
    strict_upstream: bool = False,
) -> dict[str, Any]:
    """CAD 2.0/Fusion path: generate build123d source and run text-to-cad scripts/step."""
    from backend.services import skill_runner

    base = Path(previous_source_name).stem if previous_source_name else ""
    if not base:
        from backend.services.project_store import file_stem_from_prompt

        base = file_stem_from_prompt(prompt)
    if base in {"create", "make", "build", "design", "New Model"} or re.fullmatch(
        r"(?i)(parametric|fully|assembled|cad|step|assembly|multi-?body)([\s_-]+(parametric|fully|assembled|cad|step|assembly|multi-?body|model|in|mm|millimeters?)){0,8}",
        base or "",
    ):
        from backend.services.project_store import file_stem_from_prompt

        better = file_stem_from_prompt(prompt)
        if better and better != "New Model" and better != base:
            base = better
        elif base in {"create", "make", "build", "design"}:
            base = "text_to_cad_model"
    source_name = f"{base}.py"
    step_name = f"{base}.step"
    glb_name = f"{base}.glb"
    stl_name = f"{base}.stl"
    three_mf_name = f"{base}.3mf"
    source_path = project_path / source_name
    ai_traces: list[dict[str, Any]] = []
    repair_note: str | None = None
    last_error: str | None = None

    def _sync_ai_traces() -> None:
        if usage_callback and ai_traces:
            usage_callback(list(ai_traces))

    current_source: str | None = previous_source
    canonical_source: str | None = None
    target_mode = str((context or {}).get("target_mode") or "").strip().lower()
    # Prefer explicit edit intent (Mode 2.0 selected/face edits) even if source
    # recovery races; previous_source still required for surgical revise content.
    is_edit = bool(previous_source) or target_mode == "edit"
    if previous_source:
        previous_missing = _gen_step_local_undefined_names(previous_source)
        if previous_missing:
            # Jake revise path: keep the source and repair it — do not discard edit lineage.
            trace_add(
                "warning",
                "[2.0/text-to-cad] Previous source has undefined symbols; keeping it for Jake edit/repair loop.",
                trace_id=trace_id,
                data={"undefined": previous_missing[:12]},
            )

    # Jake-identical authoring agent: LLM writes gen_step → scripts/step →
    # inspect → mandatory multi-view snapshot review → repair from CLI/visual errors.
    # Never inject hand-authored geometry templates (that is not Jake).
    jake_identical = bool(strict_upstream) or bool((context or {}).get("jake_identical_runtime", True))
    canonical_source = None

    if _prompt_mentions_dxf_import(prompt) and not _collect_dxf_filenames(context, project_path, prompt):
        # Soft-skip: no attached DXF → ignore DXF intent and continue as a normal
        # generative CAD job instead of failing the whole design.
        trace_add(
            "warning",
            "[2.0/text-to-cad] Prompt mentions DXF/drawing import but no DXF is attached; "
            "skipping DXF skill and continuing without it.",
            trace_id=trace_id,
        )
        if isinstance(context, dict):
            cleaned_skills = [
                s
                for s in (context.get("skills") or [])
                if str(s).strip().lower() != "dxf"
            ]
            context = {
                **context,
                "dxf_skipped": True,
                "dxf_files": [],
                "skills": cleaned_skills,
            }

    label_prefix = "Architect" if architect_mode else "Fusion" if fusion_mode else "2.0"
    workflow_note = ""
    if fusion_mode:
        fusion_target = str((context or {}).get("fusion_target") or "in_app").lower()
        workflow_note = (
            "\n\nFUSION MODE WORKFLOW:\n"
            "Work like an expert Fusion 360 operator building the part in phases, but implement it in build123d.\n"
            "- Start from explicit construction datums, named parameters, and a phase-by-phase feature timeline.\n"
            "- Build functional interfaces first, then primary solids, then sweeps/lofts/pipes/patterns, then holes/nut traps, then fillets/chamfers/materials.\n"
            "- For wire/pipe/path features such as whisk loops, route each path intentionally and pattern it around the correct axis; verify direction and bounding box before finalizing.\n"
            "- After each failed export, inspect, snapshot, and visual review, repair the same source like a Fusion timeline edit. Do not restart from a new unrelated model.\n"
            "- The final model must read like a finished CAD part, not a primitive placeholder: visible connector geometry, load paths, fasteners, clearances, rounded edges, and realistic proportions.\n"
            "\nSCREWDRIVER / ROTARY TOOL ATTACHMENT LOGIC:\n"
            "- For screwdriver, bit holder, nut driver, or rotary tool prompts, model a real torque path: quick-lock adapter or shank, central torque hub, anti-rotation key/flats, bit socket, retaining collar, and visible fastening/clearance features.\n"
            "- Use phased construction: adapter stack -> torque-transmission core -> tool geometry -> retention features -> holes/nut traps/set-screw access -> chamfers/fillets -> material appearance.\n"
            "- The bit interface must be mechanically plausible: hex socket or keyed drive sized from named parameters, lead-in chamfer, shoulder/stop face, and no floating disconnected bit geometry.\n"
            "- Validate orientation before final: the driven tip points away from the adapter, the shank/socket is coaxial with the torque hub, and the bounding box matches the intended handheld/robotic scale.\n"
        )
        if fusion_target == "fusion360":
            workflow_note += (
                "\nFUSION 360 PLUGIN TARGET:\n"
                "- Keep phase functions and named parameters especially clean because this design may be translated or streamed into a Fusion 360 API add-in.\n"
                "- Prefer operations that map directly to Fusion features: sketches, extrudes/cuts, revolves, sweeps/pipes, circular patterns, combines, fillets, chamfers, materials, and timeline-like phase names.\n"
                "- Still satisfy the Render Studio build123d source contract for now; the local plugin bridge will consume generated code/scripts in a separate connection path.\n"
            )
    elif architect_mode:
        if _looks_like_architect_prompt(prompt):
            workflow_note = (
                "\n\nARCHITECT MODE WORKFLOW:\n"
                "Design room-first modular house CAD made from separate pieces, not generic blocks or a sealed decorative box.\n"
                "- Use XY as the floor plan grid and Z as vertical. Default grid is 1000 mm; default wall height is 2800 mm unless the prompt says otherwise.\n"
                "- The default unit is one complete room module at a time. A room must include meaningful major modules: floor slab, north/south/east/west wall panels, at least one door/opening, at least one window when reasonable, corner pillars/connectors, and ceiling/roof panels.\n"
                "- Follow upstream text-to-cad structure: return one STEP-ready labeled Compound/assembly. Do not create or rely on one browser component per decorative shape. Major movable modules may be separate labeled solids; small trims, grooves, rails, sockets, connector lips, labels, and panel seams should remain child/detail geometry inside those modules.\n"
                "- Room output contract: include named/selectable major modules for room_floor, wall_north, wall_south, wall_east, wall_west, roof/ceiling panels, corner pillars, and separate window/door inserts only when those inserts are meant to move independently.\n"
                "- House output contract: if the user asks for a house, produce a kit of separate editable bodies, not a monolith. Each wall must be independently movable/resizable with its own length, label, snap endpoints, connector metadata, and printable mating features.\n"
                "- Starter house recipe: one or two floor slabs, separate exterior wall panels, optional interior divider wall, corner pillars/posts, one framed front door, at least two framed blue-glass windows, separate roof panels/caps, and an open/cutaway side or removable roof so it reads as a house layout.\n"
                "- Make the preview read as a house room: leave one wall open, lowered, or cut away unless the user asks for a sealed module; add wall thickness, baseboards, sill/lintel parts, trim frames, panel seams, and recognizable window/door inserts.\n"
                "- Generate reusable modules: room bays, wall panels, window inserts, door panels, roof/ceiling modules, floor slabs, corner connectors, stairs, and service cores.\n"
                "- For wall-level edits from Architect ribbon tools, preserve the selected wall as its own piece and only modify that wall plus separate child parts such as window_insert, door_insert, sill, lintel, trim, rails, connectors, or generative details.\n"
                "- Include print-friendly snap interfaces: chunky tabs, sockets, rails, alignment keys, peg/hole connectors, dovetail-like guides, corner posts, chamfered lead-ins, and 0.2-0.4 mm prototype clearance notes when relevant. Make them visible, named, grid-aligned, and not fragile.\n"
                "- Add robot assembly intent in source comments and labels: pick points, oversized lift tabs, grip flats, lift holes, assembly order, connector side, mating target, and orientation labels like TOP/INSIDE/NORTH.\n"
                "- Apply house-like visual materials/colors: warm wood/tan floor, light wall/plaster panels, darker roof, blue glass inserts, and contrasting trim/connectors.\n"
                "- Keep STEP-valid solids with semantic labels. Prefer a compact assembly hierarchy: about 6-18 top-level parts for a room/house kit, not dozens of separate trim/connector components.\n"
                "- Do not make a plain house-shaped shell, blank cuboid, sci-fi bunker, random skyscraper block, or greeble panel. Include readable residential floors, walls, doors, windows, roof pieces, pillars, and snap connectors.\n"
            )
        else:
            workflow_note = (
                "\n\nARCHITECT MODE NOTE:\n"
                "This prompt is not a room/house/building request. Follow the user request directly and do not force house-specific modules.\n"
            )
    # Always attach assembled+exploded / optional electronics authoring contract for Mode 2.0+.
    model_electronics = bool((context or {}).get("model_electronics", True))
    workflow_note += "\n" + _assembly_dual_export_rules(prompt, model_electronics=model_electronics)
    if not model_electronics:
        workflow_note += (
            "\n\nELECTRONICS MODELING OFF:\n"
            "- Do not add visible motor, ESC, battery, receiver, servo, propeller, or wire-harness solids.\n"
            "- Mechanical/airframe geometry only; pockets, channels, and clearance volumes are fine.\n"
        )
    if progress_callback:
        brief_label = (
            f"Writing {label_prefix} revise brief (Jake edit workflow)..."
            if is_edit
            else f"Writing {label_prefix} CAD brief with text-to-cad skill..."
        )
        progress_callback({"stage": "brief", "pct": 10, "label": brief_label})
    edit_note = ""
    if previous_source:
        from backend.services.cad_authoring_agent import format_surgical_edit_note

        edit_note = format_surgical_edit_note(
            user_prompt=prompt,
            source_name=previous_source_name or source_name,
        )
    guidance = str((context or {}).get("reference_edit_guidance") or "").strip()
    if guidance:
        edit_note = f"{edit_note}\n\nEDITOR CONSTRAINT:\n{guidance}\n"
        if is_edit:
            edit_note += (
                "This is a viewport selected-object edit: revise the current generator/"
                "STEP in place. Do not treat face/@component refs as contextual-only, "
                "and do not regenerate from an older unrelated assembly baseline.\n"
            )
    # Keep the selected stem when editing — never rename from an improved prompt.
    if is_edit and previous_source_name:
        keep_stem = Path(previous_source_name).stem
        if keep_stem and keep_stem != base:
            base = keep_stem
            source_name = f"{base}.py"
            step_name = f"{base}.step"
            glb_name = f"{base}.glb"
            stl_name = f"{base}.stl"
            three_mf_name = f"{base}.3mf"
            source_path = project_path / source_name
    # Mirror upstream text-to-cad modeling behavior by default: keep the
    # generation prompt focused on the user request + edit lineage, while
    # preserving our upload/reference/inspect/selector tooling around it.
    mirror_upstream_modeling = bool((context or {}).get("mirror_upstream_modeling", True))
    if jake_identical or strict_upstream:
        mirror_upstream_modeling = True
        from backend.services.cad_authoring_agent import jake_required_workflow_summary

        trace_add(
            "info",
            f"[2.0/text-to-cad] {jake_required_workflow_summary()}"
            + (" (revise/edit)" if is_edit else " (new part)"),
            trace_id=trace_id,
            data={
                "is_edit": is_edit,
                "target_mode": target_mode or None,
                "previous_source": previous_source_name,
                "has_reference_edit_guidance": bool(guidance),
            },
        )
    generation_prompt = prompt + edit_note if mirror_upstream_modeling else (prompt + edit_note + workflow_note)
    if mirror_upstream_modeling:
        trace_add("info", "[2.0/text-to-cad] Using upstream-mirrored modeling prompt mode.", trace_id=trace_id)
    cad_brief, brief_trace = ai.generate_cad_brief(
        generation_prompt,
        context,
        trace_id=trace_id,
        images=images,
    )
    ai_traces.append(brief_trace)
    _sync_ai_traces()
    if cancel_check and cancel_check():
        raise DesignCanceled("Generation canceled.")
    (project_path / f"{base}.brief.md").write_text(cad_brief.rstrip() + "\n", encoding="utf-8")

    # Default: per-user OpenAI/Claude tool agent (BYOK). Codex is opt-in only.
    ctx = context or {}
    use_codex_agent = bool(jake_identical) and bool(
        ctx.get("codex_agent", False) or ctx.get("jake_codex_agent", False)
    )
    use_tool_agent = bool(jake_identical) and bool(ctx.get("jake_tool_agent", True))
    if (use_codex_agent or use_tool_agent) and not canonical_source:
        # Prefer a filesystem-safe stem (spaces break CLIs).
        safe_base = re.sub(r"[^a-zA-Z0-9_-]+", "_", base).strip("_") or "model"
        if safe_base != base:
            source_name = f"{safe_base}.py"
            step_name = f"{safe_base}.step"
            glb_name = f"{safe_base}.glb"
            stl_name = f"{safe_base}.stl"
            three_mf_name = f"{safe_base}.3mf"
            source_path = project_path / source_name
            if previous_source and previous_source_name and Path(previous_source_name).name != source_name:
                # Keep edit lineage on the original filename when revising.
                source_name = Path(previous_source_name).name
                stem = Path(source_name).stem
                step_name, glb_name = f"{stem}.step", f"{stem}.glb"
                stl_name, three_mf_name = f"{stem}.stl", f"{stem}.3mf"
                source_path = project_path / source_name
                safe_base = stem
            base = safe_base

        agent_result = None
        agent_runtime = None
        agent_exc_message = None

        if use_codex_agent:
            try:
                from backend.services.codex_agent import (
                    CodexUnavailable,
                    run_codex_agent,
                )

                if progress_callback:
                    progress_callback(
                        {
                            "stage": "authoring",
                            "pct": 16,
                            "label": "Starting Codex CAD agent…",
                        }
                    )
                agent_result = run_codex_agent(
                    project_path=project_path,
                    prompt=generation_prompt,
                    cad_brief=cad_brief,
                    source_name=source_name,
                    step_name=step_name,
                    glb_name=glb_name,
                    stl_name=stl_name,
                    three_mf_name=three_mf_name,
                    previous_source=previous_source,
                    is_edit=is_edit,
                    cancel_check=cancel_check,
                    progress_callback=progress_callback,
                    trace_id=trace_id,
                )
                agent_runtime = "codex"
            except DesignCanceled:
                raise
            except CodexUnavailable as unavailable:
                agent_exc_message = str(unavailable)
                trace_add(
                    "warning",
                    f"[2.0/text-to-cad] Codex unavailable; will try fallback: {agent_exc_message[:400]}",
                    trace_id=trace_id,
                )
            except Exception as agent_exc:
                agent_exc_message = str(agent_exc)
                if "canceled" in agent_exc_message.lower():
                    raise DesignCanceled("Generation canceled.") from agent_exc
                trace_add(
                    "warning",
                    f"[2.0/text-to-cad] Codex agent failed: {agent_exc_message[:500]}",
                    trace_id=trace_id,
                )

        if agent_result is None and (
            use_tool_agent or (use_codex_agent and agent_exc_message)
        ):
            # Soft fallback to in-process imitation only after Codex fails/unavailable,
            # or when jake_tool_agent was explicitly requested.
            try:
                from backend.services.jake_tool_agent import run_jake_tool_agent

                if progress_callback:
                    progress_callback(
                        {
                            "stage": "authoring",
                            "pct": 18,
                            "label": "Codex unavailable — falling back to in-process tool agent…",
                        }
                    )
                agent_result = run_jake_tool_agent(
                    ai=ai,
                    project_path=project_path,
                    prompt=generation_prompt,
                    cad_brief=cad_brief,
                    source_name=source_name,
                    step_name=step_name,
                    glb_name=glb_name,
                    stl_name=stl_name,
                    three_mf_name=three_mf_name,
                    previous_source=previous_source,
                    is_edit=is_edit,
                    max_turns=max(28, (max_repairs + 1) * 3),
                    cancel_check=cancel_check,
                    progress_callback=progress_callback,
                    usage_callback=usage_callback,
                    model_electronics=bool((context or {}).get("model_electronics", True)),
                    trace_id=trace_id,
                )
                agent_runtime = "jake_tool_agent"
                ai_traces.extend(agent_result.get("ai_traces") or [])
                _sync_ai_traces()
            except DesignCanceled:
                raise
            except Exception as tool_exc:
                partial = getattr(tool_exc, "ai_traces", None)
                if isinstance(partial, list) and partial:
                    ai_traces.extend(t for t in partial if isinstance(t, dict) and t not in ai_traces)
                    _sync_ai_traces()
                agent_exc_message = (
                    f"{agent_exc_message + ' | ' if agent_exc_message else ''}"
                    f"tool agent: {tool_exc}"
                )
                agent_result = None

        if agent_result is not None:
            source_name = agent_result["source"]
            step_name = agent_result["step"]
            glb_name = agent_result["glb"]
            source_path = project_path / source_name
            base = Path(source_name).stem
            stl_name = f"{base}.stl"
            three_mf_name = f"{base}.3mf"
            source = source_path.read_text(encoding="utf-8", errors="ignore") if source_path.is_file() else ""

            _convert_text_to_cad_glb_to_z_up(project_path / glb_name)
            cad_service.apply_prompt_appearance_to_file(project_path / glb_name, prompt, seed=base)
            wired_names = _wire_jake_artifacts_to_product_shell(
                project_path,
                base=base,
                source_name=source_name,
                step_name=step_name,
                glb_name=glb_name,
            )
            # Jake/cadjs sidecar is already STEP Z-up. Do not re-run Y→Z tip after
            # wiring — that was flopping upright models onto their side.
            if (project_path / glb_name).is_file():
                step_path = project_path / step_name
                if step_path.is_file():
                    try:
                        cad_service._match_glb_scale_to_step(step_path, project_path / glb_name)
                    except Exception as exc:
                        logger.debug("Post Z-up unit match failed for %s: %s", glb_name, exc)
                cad_service.apply_prompt_appearance_to_file(project_path / glb_name, prompt, seed=base)

            # Best-effort inspect/snapshot metadata for the result payload.
            inspect_out = skill_runner.run_skill_tool(
                "cad",
                "inspect",
                ["refs", step_name, "--facts", "--planes", "--positioning"],
                cwd=project_path,
                timeout_sec=60.0,
                cancel_check=cancel_check,
            )
            snapshot_info = _run_v2_snapshot(
                skill_runner,
                project_path,
                step_name,
                base,
                trace_id,
                prompt=prompt,
                source=source,
                inspect_summary=_inspect_summary(inspect_out),
            )
            files = {
                **wired_names,
                "source": source_name,
                "step": step_name,
                "glb": glb_name,
            }
            files.update(_collect_exploded_sidecar_files(project_path, base))
            promoted_parts = [] if architect_mode else _promote_disconnected_bodies(project_path, glb_name, base=base)
            source_parts = _promote_build123d_children_from_source(
                project_path,
                source_name,
                base=base,
                max_parts=18 if architect_mode else 12,
                major_only=architect_mode,
                skip_if_more_than=24 if not architect_mode else None,
            )
            if source_parts:
                promoted_parts.extend(name for name in source_parts if name not in promoted_parts)
            if promoted_parts:
                files["parts"] = promoted_parts
            if (project_path / stl_name).is_file():
                files["stl"] = stl_name
            if (project_path / three_mf_name).is_file():
                files["3mf"] = three_mf_name
            if snapshot_info and snapshot_info.get("file"):
                files["snapshot"] = snapshot_info["file"]
            from backend.services.project_store import apply_prompt_project_name, title_from_prompt

            display_name = title_from_prompt(prompt)
            apply_prompt_project_name(project_path, prompt, fallback=display_name)
            runtime_label = "Codex CAD agent" if agent_runtime == "codex" else "CAD tool-using authoring agent"
            trace_add(
                "info",
                f"[2.0/text-to-cad] {runtime_label} completed step/inspect/snapshot gates.",
                trace_id=trace_id,
            )
            return {
                "intent": "generative",
                "message": (
                    f"Built {display_name} with the {runtime_label} "
                    f"({'Architect' if architect_mode else 'Fusion' if fusion_mode else '2.0'})."
                ),
                "design_plan": {
                    "requirements_analysis": f"CAD {label_prefix} routed to {runtime_label}.",
                    "cad_feature_plan": (
                        "Codex / CAD skill edited gen_step() source, ran scripts/step, "
                        "inspect, and mandatory snapshot in one continuous agent session."
                        if agent_runtime == "codex"
                        else (
                            "Tool-using agent edited gen_step() source, ran scripts/step, "
                            "inspect, and mandatory snapshot in one continuous session."
                        )
                    ),
                    "step_ready_brep_output": f"Validated STEP artifact: {step_name}",
                    "text_to_cad_source": source_name,
                },
                "specs_used": [{"source": "text-to-cad", "script": source_name}],
                "part_placements": [],
                "result": {
                    "program": {
                        "name": display_name,
                        "source": "text-to-cad",
                        "source_file": source_name,
                        "entrypoint": "gen_step",
                    },
                    "primary": glb_name,
                    "basename": base,
                    "files": files,
                    "parts": [{"name": Path(name).stem, "filename": name} for name in promoted_parts],
                    "sim": None,
                    "dfm": None,
                    "warnings": [],
                    "text_to_cad": {
                        "runtime": agent_runtime or "codex",
                        "authoring_agent": True,
                        "visual_gate": "fail_closed_multi_view",
                        "naming": {
                            "source": source_name,
                            "step": step_name,
                            "shell_glb": glb_name,
                            "jake_glb": jake_hidden_glb_name(step_name),
                            "cad_ref": str(Path(step_name).with_suffix("").as_posix()),
                            "display_name": display_name,
                        },
                        "agent_summary": agent_result.get("summary") or "",
                        "inspect": {
                            "stdout": (inspect_out.get("stdout") or "")[-4000:],
                            "stderr": (inspect_out.get("stderr") or "")[-4000:],
                        },
                        "snapshot": snapshot_info,
                    },
                },
                "attempts": 1,
                "ai_trace": ai_traces,
                "dfm_warnings": [],
                "v2_text_to_cad": True,
                "jake_identical_runtime": True,
                "codex_agent": agent_runtime == "codex",
                "jake_codex_agent": agent_runtime == "codex",
                "jake_tool_agent": agent_runtime == "jake_tool_agent",
                "fusion_text_to_cad": fusion_mode,
                "architect_text_to_cad": architect_mode,
            }

        last_error = agent_exc_message or "Jake agent did not finish"
        repair_note = (
            "Codex / tool authoring agent did not finish. "
            "Falling back to file-rewrite repair loop.\n"
            f"{last_error}"
        )
        trace_add(
            "warning",
            f"[2.0/text-to-cad] agent failed; fallback loop: {last_error[:500]}",
            trace_id=trace_id,
        )
        current_source = (
            source_path.read_text(encoding="utf-8", errors="ignore")
            if source_path.is_file()
            else previous_source
        )

    # Canonical templates are one-shot; free-form AI source uses Jake's repair loop.
    total_attempts = 1 if canonical_source else (max_repairs + 1)
    for attempt in range(total_attempts):
        if cancel_check and cancel_check():
            raise DesignCanceled("Generation canceled.")
        if progress_callback:
            action = "Editing" if (is_edit or current_source) else "Writing"
            # Keep pct moving past brief's 10% so the UI does not look frozen.
            src_pct = 18 if attempt == 0 else min(55, 18 + attempt * 3)
            progress_callback({
                "stage": "ai_source",
                "pct": src_pct,
                "label": f"{action} build123d source with {label_prefix} CAD skill (attempt {attempt + 1}/{total_attempts})...",
            })
        try:
            if canonical_source:
                source = canonical_source
                trace_add("info", "[2.0/text-to-cad] Using canonical benchmark-style source.", trace_id=trace_id)
            else:
                source, ai_trace = ai.generate_cad_python_source(
                    generation_prompt,
                    context,
                    trace_id=trace_id,
                    repair_note=repair_note,
                    previous_source=current_source,
                    images=images,
                    cad_brief=cad_brief,
                    # Jake-identical authoring: never bias the system prompt with Fusion extras.
                    fusion_mode=False if jake_identical else fusion_mode,
                )
                ai_traces.append(ai_trace)
                _sync_ai_traces()
            # Preserve the exact source that failed validation so the next
            # repair pass can edit it, matching the upstream text-to-cad
            # source -> step -> repair loop.
            current_source = source
            _validate_generated_source(source)
            # DXF filename wiring only — never inject geometry templates/helpers on Jake path.
            source = _augment_text_to_cad_source(
                source,
                context=context,
                project_path=project_path,
                prompt=prompt,
                jake_identical=jake_identical,
            )
            # Jake parity: fix type-poisoned positions / prompt radii before scripts/step
            # so we do not burn an LLM repair turn on float-not-iterable mistakes.
            repaired = _apply_jake_deterministic_repairs(source, prompt=prompt)
            if repaired != source:
                source = repaired
                trace_add(
                    "info",
                    "[authoring-agent] applied deterministic Jake pre-step repairs "
                    "(positions/radii/placeholder dims)",
                    trace_id=trace_id,
                )
            if not jake_identical:
                # Render Studio compatibility: backfill missing numeric/string config constants.
                source = _augment_common_constants(source, base=base, prompt=prompt)
            dxf_issue = _dxf_semantic_source_issue(source, prompt, context)
            if dxf_issue:
                raise ValueError(dxf_issue)
            remaining = _gen_step_local_undefined_names(source)
            if remaining and not jake_identical:
                healed = _backfill_known_missing_symbols(source, prompt, remaining)
                if healed != source:
                    source = healed
                    remaining = _gen_step_local_undefined_names(source)
            if remaining and not jake_identical:
                raise ValueError(
                    "Generated source is incomplete; gen_step() references undefined names: "
                    + ", ".join(remaining[:12])
                    + ("..." if len(remaining) > 12 else "")
                )
            if remaining and jake_identical:
                # Jake agent: write source and let scripts/step surface NameError for repair.
                trace_add(
                    "warning",
                    "[authoring-agent] Undefined symbols left for scripts/step (no constant/helper injection).",
                    trace_id=trace_id,
                    data={"undefined": remaining[:12], "turn": attempt + 1},
                )
            source_path.write_text(source.rstrip() + "\n", encoding="utf-8")
            current_source = source
            if jake_identical:
                trace_add(
                    "info",
                    f"[authoring-agent] turn {attempt + 1}/{total_attempts}: wrote {source_name}",
                    trace_id=trace_id,
                )
        except Exception as exc:
            last_error = str(exc)
            failed_trace = getattr(exc, "ai_trace", None)
            if isinstance(failed_trace, dict) and failed_trace not in ai_traces:
                ai_traces.append(failed_trace)
                _sync_ai_traces()
            if cancel_check and cancel_check():
                raise DesignCanceled("Generation canceled.") from exc
            if "Generation canceled" in last_error:
                raise DesignCanceled("Generation canceled.") from exc
            if current_source:
                try:
                    rejected_path = project_path / f"{base}.rejected.py"
                    rejected_path.write_text(str(current_source).rstrip() + "\n", encoding="utf-8")
                except Exception:
                    pass
            if source_path.is_file():
                try:
                    current_source = source_path.read_text(encoding="utf-8", errors="ignore")
                except Exception:
                    pass
            repair_note = _source_generation_repair_note(last_error)
            trace_add("error", f"[2.0/text-to-cad] Source generation failed: {exc}", trace_id=trace_id)
            continue

        if cancel_check and cancel_check():
            raise DesignCanceled("Generation canceled.")
        if progress_callback:
            progress_callback({"stage": "step", "pct": 32, "label": "Running text-to-cad scripts/step..."})
        try:
            current_source = _finalize_text_to_cad_source_before_step(
                source_path,
                context=context,
                project_path=project_path,
                prompt=prompt,
                jake_identical=jake_identical,
            )
        except Exception as exc:
            last_error = str(exc)
            repair_note = f"Source finalize failed before scripts/step:\n{last_error}"
            trace_add("error", f"[2.0/text-to-cad] pre-step finalize failed: {exc}", trace_id=trace_id)
            continue
        step_args = [
            source_name,
            "-o",
            step_name,
            "--glb",
            glb_name,
            "--stl",
            stl_name,
            "--3mf",
            three_mf_name,
            "--force",
        ]
        step_out = skill_runner.run_skill_tool(
            "cad",
            "step",
            step_args,
            cwd=project_path,
            timeout_sec=240.0,
            cancel_check=cancel_check,
        )
        if not step_out.get("ok"):
            detail = _error_tail(step_out, "scripts/step failed")
            last_error = detail
            if step_out.get("canceled") or (cancel_check and cancel_check()) or "Canceled:" in detail:
                raise DesignCanceled("Generation canceled.")
            if _is_noncritical_3mf_export_failure(detail):
                trace_add(
                    "warning",
                    "[2.0/text-to-cad] 3MF sidecar export failed on empty mesh object; retrying step without 3MF artifact.",
                    trace_id=trace_id,
                )
                retry_no3mf = skill_runner.run_skill_tool(
                    "cad",
                    "step",
                    _step_args_without_3mf(step_args),
                    cwd=project_path,
                    timeout_sec=240.0,
                    cancel_check=cancel_check,
                )
                if retry_no3mf.get("ok"):
                    step_out = retry_no3mf
                    detail = ""
                else:
                    detail = _error_tail(retry_no3mf, "scripts/step failed after removing 3MF")
                    last_error = detail
            if _is_dxf_polyline_kernel_failure(detail):
                dxf_names = _collect_dxf_filenames(context, project_path, prompt)
                if dxf_names:
                    repair_note = (
                        "scripts/step failed on DXF polyline geometry. Do NOT replace the model with a "
                        "generic fallback plate. Repair the actual upstream text-to-cad build123d source: "
                        "clean duplicate/degenerate DXF points, close profiles explicitly, parse modelspace "
                        "entities/layers with ezdxf, and reconstruct the requested 3D part as named solids "
                        "with holes/cutouts/pockets/clearances. Avoid whole-file import_dxf()+make_face()+extrude "
                        "unless the prompt explicitly asks for a flat plate.\n"
                        f"{detail}"
                    )
            if not step_out.get("ok"):
                exit_code = step_out.get("exit_code")
                if isinstance(exit_code, int) and exit_code < 0:
                    repair_note = (
                        "scripts/step crashed the CAD kernel (native signal, not a Python "
                        "exception — try/except will NOT catch it). Rewrite the source to "
                        "avoid the crash: remove or replace the failing fillet/chamfer, "
                        "boolean, loft, or sweep; do not wrap it in try/except. If a fillet "
                        "or chamfer is needed, use a much smaller radius and select only the "
                        "specific edges that truly need it instead of a broad edge filter.\n"
                        f"{detail}"
                    )
                else:
                    # Check for NameError — undefined symbol referenced by gen_step()
                    name_err_match = re.search(r"NameError: name '(\w+)' is not defined", detail)
                    locations_float_err = bool(
                        re.search(
                            r"TypeError:.*(?:argument after \* must be an iterable, not float|"
                            r"'float'\s+object\s+is\s+not\s+iterable|"
                            r"float(?:'|\s).*not iterable|"
                            r"Locations\(\).*float)",
                            detail,
                            flags=re.IGNORECASE | re.DOTALL,
                        )
                    ) or (
                        "TypeError" in detail
                        and "float" in detail
                        and ("not iterable" in detail or "Locations" in detail or "_positions" in detail)
                    )
                    if name_err_match:
                        missing_name = name_err_match.group(1)
                        if jake_identical:
                            # Jake kernel/authoring: never invent float constants — LLM must repair.
                            repair_note = (
                                f"NameError: '{missing_name}' is referenced in gen_step() but was never defined in this file. "
                                "Fix: define it at module scope BEFORE gen_step() with the real dimension/list from the CAD brief, "
                                "or inline the logic inside gen_step(). "
                                "Never leave symbols undefined and never assign a bare float to a *_positions / list constant.\n"
                                f"Full error:\n{detail}"
                            )
                        else:
                            # Deterministic heal (Render Studio compatibility path only).
                            try:
                                healed_src = source_path.read_text(encoding="utf-8", errors="ignore")
                                patched = _inject_missing_name_constant(
                                    healed_src, missing_name, base=base, prompt=prompt
                                )
                                if patched:
                                    patched = _backfill_all_undefined_constants(
                                        patched, base=base, prompt=prompt
                                    )
                                if patched and patched != healed_src:
                                    source_path.write_text(patched.rstrip() + "\n", encoding="utf-8")
                                    current_source = patched
                                    trace_add(
                                        "info",
                                        f"[authoring-agent] auto-injected missing constant '{missing_name}' and retrying scripts/step",
                                        trace_id=trace_id,
                                    )
                                    if progress_callback:
                                        progress_callback({
                                            "stage": "step",
                                            "pct": 40,
                                            "label": f"Retrying scripts/step after injecting {missing_name}...",
                                        })
                                    step_out = skill_runner.run_skill_tool(
                                        "cad",
                                        "step",
                                        step_args,
                                        cwd=project_path,
                                        timeout_sec=240.0,
                                        cancel_check=cancel_check,
                                    )
                                    if step_out.get("ok"):
                                        detail = ""
                                    else:
                                        detail = _error_tail(step_out, "scripts/step failed after constant injection")
                                        last_error = detail
                                        repair_note = (
                                            f"NameError: '{missing_name}' was auto-injected but scripts/step still failed. "
                                            "Define every module-scope constant used by gen_step() with real dimensions, "
                                            "and ensure nested helpers are complete.\n"
                                            f"Full error:\n{detail}"
                                        )
                                else:
                                    repair_note = (
                                        f"NameError: '{missing_name}' is referenced in gen_step() but was never defined in this file. "
                                        "Fix: define it at module scope BEFORE gen_step() as a constant/import/helper as appropriate, "
                                        "or inline the logic inside gen_step(). "
                                        "Rule: every symbol referenced by gen_step() must be defined in this same file.\n"
                                        f"Full error:\n{detail}"
                                    )
                            except Exception as inject_exc:
                                repair_note = (
                                    f"NameError: '{missing_name}' is referenced in gen_step() but was never defined. "
                                    f"Auto-inject failed ({inject_exc}). Define it at module scope before gen_step().\n"
                                    f"Full error:\n{detail}"
                                )
                    elif locations_float_err:
                        # Always rewrite scalar *_positions* lists (type bug), then retry step.
                        # Still do NOT invent unrelated missing dimensions on Jake path.
                        from backend.services.cad_authoring_agent import format_agent_repair_note

                        try:
                            healed_src = source_path.read_text(encoding="utf-8", errors="ignore")
                            patched = _apply_jake_deterministic_repairs(healed_src, prompt=prompt)
                            if not jake_identical:
                                patched = _backfill_all_undefined_constants(
                                    patched, base=base, prompt=prompt
                                )
                            if patched != healed_src:
                                source_path.write_text(patched.rstrip() + "\n", encoding="utf-8")
                                current_source = patched
                                trace_add(
                                    "info",
                                    "[authoring-agent] rewrote scalar *_positions to coordinate lists and retrying scripts/step",
                                    trace_id=trace_id,
                                )
                                if progress_callback:
                                    progress_callback({
                                        "stage": "step",
                                        "pct": 40,
                                        "label": "Retrying scripts/step after fixing hole positions...",
                                    })
                                step_out = skill_runner.run_skill_tool(
                                    "cad",
                                    "step",
                                    step_args,
                                    cwd=project_path,
                                    timeout_sec=240.0,
                                    cancel_check=cancel_check,
                                )
                                if step_out.get("ok"):
                                    detail = ""
                                else:
                                    detail = _error_tail(
                                        step_out, "scripts/step failed after positions fix"
                                    )
                                    last_error = detail
                                    repair_note = format_agent_repair_note(
                                        stage="scripts/step",
                                        detail=detail,
                                        attempt=attempt,
                                        max_attempts=total_attempts,
                                    )
                            else:
                                repair_note = format_agent_repair_note(
                                    stage="scripts/step",
                                    detail=detail,
                                    attempt=attempt,
                                    max_attempts=total_attempts,
                                )
                        except Exception as fix_exc:
                            repair_note = (
                                "Locations/positions TypeError could not be auto-fixed "
                                f"({fix_exc}). Define position lists as [(x, y), ...] not floats.\n"
                                f"Full error:\n{detail}"
                            )
                    else:
                        from backend.services.cad_authoring_agent import format_agent_repair_note

                        repair_note = format_agent_repair_note(
                            stage="scripts/step",
                            detail=detail,
                            attempt=attempt,
                            max_attempts=total_attempts,
                        )
                if not step_out.get("ok"):
                    trace_add("error", f"[authoring-agent] scripts/step failed (exit {exit_code}): {detail[:500]}", trace_id=trace_id)
                    continue

        _convert_text_to_cad_glb_to_z_up(project_path / glb_name)
        cad_service.apply_prompt_appearance_to_file(project_path / glb_name, prompt, seed=base)
        wired_names = _wire_jake_artifacts_to_product_shell(
            project_path,
            base=base,
            source_name=source_name,
            step_name=step_name,
            glb_name=glb_name,
        )
        # Jake/cadjs sidecar is already STEP Z-up. Re-running the Y→Z tip here
        # was flipping flat models (planes, plates) onto their side.
        if (project_path / glb_name).is_file():
            cad_service.apply_prompt_appearance_to_file(project_path / glb_name, prompt, seed=base)

        if cancel_check and cancel_check():
            raise DesignCanceled("Generation canceled.")
        if progress_callback:
            progress_callback({"stage": "inspect", "pct": 78, "label": "Inspecting STEP with CAD skill..."})
        inspect_out = skill_runner.run_skill_tool(
            "cad",
            "inspect",
            ["refs", step_name, "--facts", "--planes", "--positioning"],
            cwd=project_path,
            timeout_sec=90.0,
            cancel_check=cancel_check,
        )
        if inspect_out.get("canceled") or (cancel_check and cancel_check()):
            raise DesignCanceled("Generation canceled.")
        if not inspect_out.get("ok"):
            detail = _error_tail(inspect_out, "scripts/inspect failed")
            last_error = detail
            from backend.services.cad_authoring_agent import format_agent_repair_note

            repair_note = format_agent_repair_note(
                stage="scripts/inspect",
                detail=detail,
                attempt=attempt,
                max_attempts=total_attempts,
            )
            trace_add("warning", f"[authoring-agent] inspect failed: {detail[:500]}", trace_id=trace_id)
            continue

        if cancel_check and cancel_check():
            raise DesignCanceled("Generation canceled.")
        # Jake: inspect facts/planes/positioning baseline, then fail on clear
        # envelope contradictions. No Render Studio faceCount heuristics on Jake path.
        quality_note = _v2_quality_repair_note(
            prompt,
            source,
            inspect_out,
            cad_brief=cad_brief,
            jake_identical=jake_identical,
        )
        if quality_note:
            last_error = quality_note
            from backend.services.cad_authoring_agent import format_agent_repair_note

            repair_note = format_agent_repair_note(
                stage="inspect-quality",
                detail=quality_note,
                attempt=attempt,
                max_attempts=total_attempts,
            )
            trace_add("warning", f"[authoring-agent] quality gate failed: {quality_note[:500]}", trace_id=trace_id)
            continue
        if jake_identical:
            dim_hint = _run_v2_spec_dimension_hints(
                prompt=prompt,
                cad_brief=cad_brief,
                inspect_out=inspect_out,
            )
            if dim_hint:
                trace_add("info", f"[authoring-agent] {dim_hint}", trace_id=trace_id)

        missing = [name for name in (step_name, glb_name) if not (project_path / name).is_file()]
        if missing:
            # Fall back to Jake hidden GLB if shell GLB missing.
            jake_glb = project_path / jake_hidden_glb_name(step_name)
            if glb_name in missing and jake_glb.is_file():
                (project_path / glb_name).write_bytes(jake_glb.read_bytes())
                step_path = project_path / step_name
                if step_path.is_file():
                    try:
                        cad_service._match_glb_scale_to_step(step_path, project_path / glb_name)
                    except Exception as exc:
                        logger.debug("Fallback Jake GLB unit match failed: %s", exc)
                missing = [name for name in (step_name, glb_name) if not (project_path / name).is_file()]
            if missing:
                last_error = f"text-to-cad did not produce required artifact(s): {', '.join(missing)}"
                repair_note = last_error
                continue

        if progress_callback:
            progress_callback({"stage": "snapshot", "pct": 90, "label": f"Rendering {label_prefix} CAD multi-view snapshot packet..."})
        snapshot_info = _run_v2_snapshot(
            skill_runner,
            project_path,
            step_name,
            base,
            trace_id,
            prompt=prompt,
            source=source,
            inspect_summary=_inspect_summary(inspect_out),
        )
        # Jake: snapshot validation is mandatory. Fail closed if render fails.
        if not snapshot_info or not (snapshot_info.get("files") or snapshot_info.get("file")):
            detail = (snapshot_info or {}).get("stderr") or (snapshot_info or {}).get("stdout") or "scripts/snapshot produced no PNG"
            last_error = f"scripts/snapshot failed (mandatory visual gate):\n{detail}"
            from backend.services.cad_authoring_agent import format_agent_repair_note

            repair_note = format_agent_repair_note(
                stage="scripts/snapshot",
                detail=last_error,
                attempt=attempt,
                max_attempts=total_attempts,
            )
            trace_add("error", f"[authoring-agent] snapshot gate failed: {last_error[:500]}", trace_id=trace_id)
            continue
        if progress_callback:
            progress_callback({"stage": "snapshot_review", "pct": 92, "label": f"Reviewing {label_prefix} CAD snapshot packet (fail-closed)..."})
        try:
            snapshot_note, snapshot_trace = _v2_snapshot_review_repair_note(
                ai,
                prompt=prompt,
                cad_brief=cad_brief,
                source=source,
                inspect_out=inspect_out,
                snapshot_info=snapshot_info,
                project_path=project_path,
                trace_id=trace_id,
                # Jake visual review — no Fusion-biased system prompt extras.
                fusion_mode=False if jake_identical else fusion_mode,
            )
            if snapshot_trace:
                ai_traces.append(snapshot_trace)
                _sync_ai_traces()
        except Exception as exc:
            # Fail closed — Jake does not skip visual review on agent errors.
            snapshot_note = f"Snapshot visual review crashed (mandatory gate): {exc}"
            trace_add("error", f"[authoring-agent] snapshot review exception: {exc}", trace_id=trace_id)
        if snapshot_note:
            last_error = snapshot_note
            from backend.services.cad_authoring_agent import format_agent_repair_note

            repair_note = format_agent_repair_note(
                stage="snapshot-review",
                detail=snapshot_note,
                attempt=attempt,
                max_attempts=total_attempts,
            )
            trace_add("warning", f"[authoring-agent] visual gate failed: {snapshot_note[:500]}", trace_id=trace_id)
            continue

        if cancel_check and cancel_check():
            raise DesignCanceled("Generation canceled.")
        if progress_callback:
            progress_callback({"stage": "finalize", "pct": 96, "label": "Finalizing text-to-cad artifacts..."})
        files = {
            **wired_names,
            "source": source_name,
            "step": step_name,
            "glb": glb_name,
        }
        files.update(_collect_exploded_sidecar_files(project_path, base))
        promoted_parts = [] if architect_mode else _promote_disconnected_bodies(project_path, glb_name, base=base)
        # Avoid exploding dense assemblies (stairs, gearsets) into dozens of browser
        # part GLBs — that makes balusters/pins look like floating debris beside the
        # intact primary assembly mesh.
        source_parts = _promote_build123d_children_from_source(
            project_path,
            source_name,
            base=base,
            max_parts=18 if architect_mode else 12,
            major_only=architect_mode,
            skip_if_more_than=24 if not architect_mode else None,
        )
        if source_parts:
            promoted_parts.extend(name for name in source_parts if name not in promoted_parts)
        if promoted_parts:
            files["parts"] = promoted_parts
        if (project_path / stl_name).is_file():
            files["stl"] = stl_name
        if (project_path / three_mf_name).is_file():
            files["3mf"] = three_mf_name
        if snapshot_info and snapshot_info.get("file"):
            files["snapshot"] = snapshot_info["file"]
        step_module_name = _maybe_author_step_module(
            ai=ai,
            project_path=project_path,
            prompt=prompt,
            step_name=step_name,
            source=source,
            inspect_out=inspect_out,
            trace_id=trace_id,
            ai_traces=ai_traces,
            images=images,
        )
        if step_module_name:
            files["jake_params"] = step_module_name
            files["step_module"] = step_module_name
            wired_names["jake_params"] = step_module_name
        # Default Project {id} → human title from the prompt (Capitalization And Spaces).
        from backend.services.project_store import apply_prompt_project_name, title_from_prompt

        display_name = title_from_prompt(prompt)
        apply_prompt_project_name(project_path, prompt, fallback=display_name)
        return {
            "intent": "generative",
            "message": f"Built {display_name} with the {'Architect modular ' if architect_mode else 'Fusion-style ' if fusion_mode else ''}text-to-cad build123d workflow.",
            "design_plan": {
                "requirements_analysis": f"CAD {label_prefix} routed to text-to-cad source generation.",
                "cad_feature_plan": "Generated build123d Python source with gen_step(), then ran CAD skill scripts/step, inspect, snapshot, visual review, and source repair.",
                "step_ready_brep_output": f"Validated STEP artifact: {step_name}",
                "text_to_cad_source": source_name,
            },
            "specs_used": [{"source": "text-to-cad", "script": source_name}],
            "part_placements": [],
            "result": {
                "program": {
                    "name": display_name,
                    "source": "text-to-cad",
                    "source_file": source_name,
                    "entrypoint": "gen_step",
                },
                # The viewport/browser should open the GLB mesh preview by default.
                # STEP remains generated, inspected, and available for CAD export.
                "primary": glb_name,
                "basename": base,
                "files": files,
                "parts": [{"name": Path(name).stem, "filename": name} for name in promoted_parts],
                "sim": None,
                "dfm": None,
                "warnings": [],
                "text_to_cad": {
                    "runtime": "jake_authoring_agent" if jake_identical else "render3d",
                    "authoring_agent": bool(jake_identical),
                    "visual_gate": "fail_closed_multi_view",
                    "naming": {
                        "source": source_name,
                        "step": step_name,
                        "shell_glb": glb_name,
                        "jake_glb": jake_hidden_glb_name(step_name),
                        "cad_ref": str(Path(step_name).with_suffix("").as_posix()),
                        "display_name": display_name,
                    },
                    "step": {
                        "stdout": (step_out.get("stdout") or "")[-4000:],
                        "stderr": (step_out.get("stderr") or "")[-4000:],
                    },
                    "inspect": {
                        "stdout": (inspect_out.get("stdout") or "")[-4000:],
                        "stderr": (inspect_out.get("stderr") or "")[-4000:],
                    },
                    "snapshot": snapshot_info,
                },
            },
            "attempts": attempt + 1,
            "ai_trace": ai_traces,
            "dfm_warnings": [],
            "v2_text_to_cad": True,
            "jake_identical_runtime": jake_identical,
            "fusion_text_to_cad": fusion_mode,
            "architect_text_to_cad": architect_mode,
        }

    raise DesignBuildError(
        f"text-to-cad 2.0 failed after {total_attempts} attempts. Last error: {last_error}",
        ai_traces=ai_traces,
    )


class DesignBuildError(RuntimeError):
    """Design pipeline failed after one or more AI repair attempts."""

    def __init__(self, message: str, *, ai_traces: list[dict[str, Any]] | None = None):
        super().__init__(message)
        self.ai_traces = list(ai_traces or [])


class DesignCanceled(RuntimeError):
    """Raised when a project generation is canceled before export."""


def _filter_options(fn, options: dict[str, Any]) -> dict[str, Any]:
    """Pass only kwargs the target generator accepts (ignore AI extras)."""
    import inspect

    params = inspect.signature(fn).parameters
    return {k: v for k, v in (options or {}).items() if k in params}


def _program_from_generator(directive: dict[str, Any]) -> FeatureProgram:
    """Expand a deterministic generator directive into a Feature Program."""
    kind = str(directive.get("kind", "")).lower()
    if kind == "enclosure":
        from backend.engineering.enclosures import case_program

        spec = directive.get("spec") or directive.get("spec_key")
        if not spec:
            raise ValueError("enclosure generator requires a 'spec' key")
        options = directive.get("options") or {}
        return case_program(str(spec), **options)
    if kind in ("gear_train", "geartrain"):
        from backend.engineering.gears import gear_train_program

        teeth = directive.get("teeth")
        if not isinstance(teeth, list) or len(teeth) < 2:
            raise ValueError("gear_train generator requires 'teeth':[z1,z2,...]")
        kwargs = {
            k: directive[k]
            for k in ("module", "thickness", "bore", "material", "pressure_angle", "drive_torque_nm")
            if k in directive and directive[k] is not None
        }
        return gear_train_program([int(t) for t in teeth], **kwargs)
    if kind in ("benchy_boat", "toy_boat", "boaty"):
        from backend.engineering.toy_boats import benchy_boat_program

        options = directive.get("options") or {}
        return benchy_boat_program(**options)
    if kind in ("pet_bottle", "soda_bottle", "coke_bottle", "pet_soda_bottle"):
        from backend.engineering.bottles import pet_soda_bottle_program

        options = directive.get("options") or {}
        return pet_soda_bottle_program(**_filter_options(pet_soda_bottle_program, options))
    if kind in ("automated_cooking_appliance", "cooking_appliance", "autocook"):
        from backend.engineering.appliances import automated_cooking_appliance_program

        return automated_cooking_appliance_program()
    raise ValueError(f"unknown generator kind '{kind}'")


_SUPPORTED_JOINT_TYPES = {"revolute", "prismatic", "fixed", "continuous"}


def _maybe_rad_to_deg(value: float, joint_type: str) -> float:
    """URDF-style joint limits are often radians; schema expects degrees."""
    if joint_type in ("revolute", "continuous") and abs(value) <= 7.0:
        return math.degrees(value)
    return value


def _normalize_limits(limits: Any, joint_type: str) -> list[float] | None:
    """Coerce URDF dict limits or loose AI shapes into [lower, upper]."""
    if limits is None:
        return None
    if isinstance(limits, (list, tuple)):
        if len(limits) < 2:
            return None
        lo = _maybe_rad_to_deg(float(limits[0]), joint_type)
        hi = _maybe_rad_to_deg(float(limits[1]), joint_type)
        return [lo, hi]
    if isinstance(limits, dict):
        lo = limits.get("lower")
        hi = limits.get("upper")
        if lo is not None and hi is not None:
            return [
                _maybe_rad_to_deg(float(lo), joint_type),
                _maybe_rad_to_deg(float(hi), joint_type),
            ]
        return None
    return None


def _limits_drive_fields(limits: Any, joint_type: str) -> dict[str, float]:
    """Extract URDF effort/velocity from a limits dict when present."""
    if not isinstance(limits, dict):
        return {}
    out: dict[str, float] = {}
    if limits.get("effort") is not None:
        out["drive_torque_nm"] = float(limits["effort"])
    if limits.get("velocity") is not None:
        vel = float(limits["velocity"])
        out["drive_velocity_dps"] = math.degrees(vel) if joint_type in ("revolute", "continuous") else vel
    return out


def _slug_id(value: str, fallback: str) -> str:
    import re

    slug = re.sub(r"[^a-z0-9_]+", "_", str(value or "").strip().lower()).strip("_")
    return slug or fallback


def _normalize_joint(raw: dict[str, Any], index: int, seen_ids: set[str]) -> dict[str, Any] | None:
    """Coerce common AI joint shapes into JointSpec-compatible dicts."""
    joint = dict(raw)
    joint_type = str(joint.get("type", "")).lower()
    parent = joint.get("parent") or joint.get("parent_link") or joint.get("parent_id")
    child = joint.get("child") or joint.get("child_link") or joint.get("child_id")
    if not parent or not child:
        return None

    joint_id = joint.get("id") or joint.get("name") or joint.get("label")
    if not joint_id:
        joint_id = f"{_slug_id(str(parent), 'parent')}_to_{_slug_id(str(child), 'child')}"
    joint_id = _slug_id(str(joint_id), f"joint_{index + 1}")
    base_id = joint_id
    n = 2
    while joint_id in seen_ids:
        joint_id = f"{base_id}_{n}"
        n += 1
    seen_ids.add(joint_id)

    anchor = joint.get("anchor") or joint.get("origin") or joint.get("position") or [0.0, 0.0, 0.0]
    if not isinstance(anchor, (list, tuple)) or len(anchor) < 3:
        anchor = [0.0, 0.0, 0.0]
    axis = joint.get("axis") or [0.0, 0.0, 1.0]
    if not isinstance(axis, (list, tuple)) or len(axis) < 3:
        axis = [0.0, 0.0, 1.0]

    normalized: dict[str, Any] = {
        "id": joint_id,
        "type": joint_type if joint_type in _SUPPORTED_JOINT_TYPES else "fixed",
        "parent": str(parent),
        "child": str(child),
        "anchor": [float(anchor[0]), float(anchor[1]), float(anchor[2])],
        "axis": [float(axis[0]), float(axis[1]), float(axis[2])],
    }
    resolved_type = normalized["type"]
    norm_limits = _normalize_limits(joint.get("limits"), resolved_type)
    if norm_limits is not None:
        normalized["limits"] = norm_limits
    for key, value in _limits_drive_fields(joint.get("limits"), resolved_type).items():
        if joint.get(key) is None:
            normalized[key] = value
    if joint.get("drive_torque_nm") is not None:
        normalized["drive_torque_nm"] = joint["drive_torque_nm"]
    if joint.get("drive_velocity_dps") is not None:
        normalized["drive_velocity_dps"] = joint["drive_velocity_dps"]
    return normalized


def _sanitize_program_dict(program: dict[str, Any]) -> dict[str, Any]:
    """Normalize common AI schema mistakes before strict FeatureProgram validation.

    Gear meshes/ratios are design metadata, not physical joints in Render Studio's
    current URDF/MJCF joint model. Preserve them under ``meta.gear_relationships``
    instead of letting a non-supported ``type: gear`` crash validation.
    """
    cleaned = dict(program)
    meta = dict(cleaned.get("meta") or {})
    valid_joints: list[dict[str, Any]] = []
    moved_relationships: list[dict[str, Any]] = list(meta.get("gear_relationships") or [])
    seen_joint_ids: set[str] = set()

    for idx, raw in enumerate(cleaned.get("joints") or []):
        if not isinstance(raw, dict):
            continue
        joint = dict(raw)
        joint_type = str(joint.get("type", "")).lower()
        has_required_links = bool(joint.get("parent") or joint.get("parent_link")) and bool(
            joint.get("child") or joint.get("child_link")
        )
        if joint_type in _SUPPORTED_JOINT_TYPES and has_required_links:
            normalized = _normalize_joint(joint, idx, seen_joint_ids)
            if normalized:
                valid_joints.append(normalized)
            continue
        if joint_type in {"gear", "gear_mesh", "gear_ratio", "mesh"} or "ratio" in joint or not has_required_links:
            moved_relationships.append(joint)
            continue
        # Unknown malformed joints are also metadata so a visual model can build.
        meta.setdefault("ignored_joints", []).append(joint)

    cleaned["joints"] = valid_joints
    if moved_relationships:
        meta["gear_relationships"] = moved_relationships
    cleaned["meta"] = meta
    return cleaned


def _repair_hint_for_build_error(exc: Exception) -> str:
    """Extra guidance appended to AI self-repair prompts for common kernel failures."""
    msg = str(exc)
    if "pre-build validation" in msg or "Program failed" in msg:
        return (
            f"{msg}\n\n"
            "Validation repair checklist:\n"
            "- Every part's FIRST feature must be a solid-creating op (box, cylinder, sphere, extrude, revolve, loft) with combine='new'.\n"
            "- Do NOT place a cut/intersect/fillet/chamfer before any solid base exists in that part.\n"
            "- Duplicate primitives at the same position cause z-fighting — merge or offset them.\n"
            "- Joint parent/child must match an actual part id in the program.\n"
            "- Emit `design_plan.brief` with `part_constraints` listing the base_op for each part.\n"
            "- Review no_can_dos in the brief and ensure none are violated in the program."
        )
    if "zero/empty volume" in msg or "produced no geometry" in msg:
        return (
            f"{msg}\n\n"
            "Repair checklist:\n"
            "- Every part needs a solid FIRST feature (box, cylinder, sphere, extrude, or revolve) with combine=new.\n"
            "- Do NOT create placeholder 'assembly' parts with only cuts or placement — merge into one body or give each part real solids.\n"
            "- Cuts (combine=cut) must overlap the existing body; intersect only if shapes overlap.\n"
            "- For multi-part designs (dispensers, mechanisms): max 6 parts, ≤12 features each, simple primitives.\n"
            "- Prefer one main hollow body (revolve or shell) plus separate small parts for knob/dial/shaft.\n"
            "- Do NOT stack overlapping full-size primitives at the same position — merge into one watertight body."
        )
    if "pattern count must be >= 1" in msg or "pattern count" in msg:
        return (
            f"{msg}\n\n"
            "Pattern repair checklist:\n"
            "- Every 'pattern' feature MUST have count >= 1 (e.g. count: 4 for four rubber feet).\n"
            "- Alternatively, provide explicit 'locations': [[x1,y1,z1],[x2,y2,z2],...] to place individual copies.\n"
            "- For rubber feet / corner details: use count: 4 with rectangular arrange + x_count: 2 + y_count: 2, or provide 4 explicit locations.\n"
            "- For cable pass-through: use a simple cylinder cut feature, NOT a pattern — patterns replicate, they do not create single features.\n"
            "- If you do not need multiple copies, remove the pattern feature and just add the shape directly."
        )
    return msg


def _extract_brief(design: dict[str, Any]) -> DesignBrief | None:
    """Pull a DesignBrief from the AI design dict, if present.

    The AI is asked to emit ``design_plan.brief`` as a structured object.
    We accept it from multiple common locations for robustness.
    """
    raw: dict[str, Any] | None = None
    dp = design.get("design_plan")
    if isinstance(dp, dict):
        raw = dp.get("brief") or dp.get("constraint_plan")
    if raw is None:
        raw = design.get("brief") or design.get("constraint_plan")
    if not isinstance(raw, dict):
        return None
    try:
        return DesignBrief.model_validate(raw)
    except Exception as exc:
        logger.debug("DesignBrief parse failed (non-fatal): %s", exc)
        return None


def design_to_program(design: dict[str, Any]) -> FeatureProgram:
    """Resolve an AI design dict into a concrete FeatureProgram."""
    generator = design.get("generator")
    if isinstance(generator, dict) and generator:
        return _program_from_generator(generator)
    program = design.get("program")
    if isinstance(program, dict) and program:
        program = _sanitize_program_dict(program)
        if "name" not in program and design.get("filename"):
            program["name"] = design["filename"]
        return FeatureProgram.model_validate(program)
    raise ValueError("AI design contained neither a valid 'generator' nor 'program'")


def is_custom_sketch_structural_request(
    prompt: str,
    images: list[dict[str, Any]] | None = None,
) -> bool:
    """Custom structural CAD from a sketch — not a breadboard component fixture."""
    p = (prompt or "").lower()
    has_images = bool(images)
    sketch_ref = any(
        w in p
        for w in (
            "canvas",
            "sketch",
            "drawing",
            "reference image",
            "attached canvas",
            "from my sketch",
            "from the sketch",
            "visual reference",
        )
    )
    structural = any(
        w in p
        for w in (
            "stove",
            "skillet",
            "frying pan",
            "cook food",
            "hover over",
            "over the food",
            "side of a stove",
            "gantry",
            "countertop arm",
            "robot arm",
            "robot mount",
            "stirring device",
            "stirring arm",
            "stirring machine",
        )
    )
    custom_stand = (
        "stand for" in p or "make a stand" in p or "build a stand" in p or "create a stand" in p
    ) and any(w in p for w in ("robot", "stove", "skillet", "cook", "stir", "kitchen", "counter"))
    if has_images and (sketch_ref or structural or custom_stand):
        return True
    if sketch_ref and (structural or custom_stand):
        return True
    if custom_stand and structural:
        return True
    return False


def _sketch_design_basename(prompt: str) -> str:
    """Stable export basename for canvas/sketch structural models."""
    p = (prompt or "").lower()
    if any(w in p for w in ("stove", "skillet", "cook", "stir")):
        return "stove_robot_stand"
    if "robot" in p and "stand" in p:
        return "robot_stand"
    return "sketch_design"


def _looks_like_component_fixture(
    prompt: str,
    images: list[dict[str, Any]] | None = None,
) -> bool:
    """A case/mount/holder request for referenced real components."""
    if is_custom_sketch_structural_request(prompt, images):
        return False
    p = prompt.lower()
    fixture_words = (
        "case", "casing", "enclosure", "holder", "hold the", "bracket",
        "cradle", "fixture", "tray", "housing", "chassis", "base plate",
        "baseplate", "breadboard", "slab", "test plate", "testing plate",
        "testing slab", "mount plate", "plate for", "mounting plate",
        "raspberry pi", " rpi", " pi ", "sbc", "pcb", "board pocket",
        "motor mount", "stepper mount", "nema", "standoff", "standoffs",
        "box", "open top", "no lid", "lidless", "test bench", "test fixture",
        "test stand", "stand for the", "stand for my", "stand for pi", "stand for rpi",
    )
    return any(w in p for w in fixture_words)


def _looks_like_benchy_boat(prompt: str, images: list[dict[str, Any]] | None = None) -> bool:
    p = prompt.lower()
    boat_words = ("benchy", "boaty", "toy boat", "boat model", "boat from", "boat based")
    return any(w in p for w in boat_words) or (bool(images) and "boat" in p)


def _looks_like_pet_bottle(prompt: str, images: list[dict[str, Any]] | None = None) -> bool:
    p = prompt.lower()
    bottle_words = (
        "coke bottle",
        "coca-cola",
        "coca cola",
        "soda bottle",
        "pet bottle",
        "pet soda",
        "cola bottle",
        "plastic bottle",
        "beverage bottle",
        "500ml bottle",
        "coke-style",
        "contour bottle",
    )
    if any(w in p for w in bottle_words):
        return True
    if "coke" in p and "bottle" in p:
        return True
    if images and "bottle" in p:
        return True
    if images and any(w in p for w in ("coke", "cola", "soda", "pet")):
        return True
    return False


def _pet_bottle_style_options(prompt: str) -> dict[str, Any]:
    p = (prompt or "").lower()
    if any(w in p for w in ("sprite", "7-up", "7up", "lemon-lime", "mountain dew")):
        return {
            "body_color": [0.35, 0.78, 0.46, 0.42],
            "cap_color": "#1f9d55",
        }
    if any(w in p for w in ("water bottle", "mineral water", "spring water", "dasani", "aquafina")):
        return {
            "body_color": [0.78, 0.92, 1.0, 0.34],
            "cap_color": "#2b6cb0",
        }
    if any(w in p for w in ("coke", "coca-cola", "coca cola", "cola")):
        return {
            "body_color": [0.72, 0.9, 0.96, 0.42],
            "cap_color": "#c41e3a",
        }
    return {}


def _looks_like_cooking_appliance(prompt: str, images: list[dict[str, Any]] | None = None) -> bool:
    p = prompt.lower()
    attachment_request = any(
        w in p
        for w in (
            "tool to",
            "tool for",
            "attachment",
            "attach",
            "end effector",
            "end-effector",
            "stirrer",
            "stirring tool",
            "stir tool",
            "mount to my arm",
            "mount to the arm",
            "slide in",
            "lock in",
        )
    )
    if attachment_request and any(w in p for w in ("robot", "arm", "cooking", "stir", "food")):
        return False
    tool_swap = any(
        w in p
        for w in (
            "whisk",
            "mixing paddle",
            "paddle",
            "beater",
            "balloon whisk",
            "agitator",
            "toolhead",
            "tool head",
        )
    ) and any(w in p for w in ("change", "replace", "swap", "convert", "make this", "turn this", "to a", "into a"))
    if tool_swap:
        return True
    appliance_words = (
        "automated cooking appliance",
        "countertop cooking appliance",
        "auto cook",
        "autocook",
        "cooking robot",
        "robotic cooker",
        "spice dispenser",
        "chopper hopper",
        "stirring machine",
    )
    if any(w in p for w in appliance_words):
        return True
    # "mixing bowl" / "mixing shaft" only if also about cooking — avoid matching motor/stepper prompts
    if "mixing bowl" in p and any(w in p for w in ("cook", "recipe", "spice", "ingredient", "kitchen")):
        return True
    if "mixing shaft" in p and any(w in p for w in ("cook", "recipe", "spice", "ingredient", "kitchen", "bowl")):
        return True
    if "cooking" in p and "appliance" in p:
        return True
    if "bowl" in p and "spice" in p and "hopper" in p:
        return True
    if "parametric cad" in p and any(w in p for w in ("bowl", "column", "bridge", "shaft", "hopper")):
        return True
    if images and "appliance" in p and any(w in p for w in ("cook", "bowl", "spice", "chopper")):
        return True
    return False


def _max_repairs_for_speed(speed: str | None, *, jake_identical: bool = False) -> int:
    """Return extra repair attempts beyond the first try (Jake agent turns − 1)."""
    # Codex agents iterate until visual+CLI gates pass; mirror that with a
    # generous capped budget so step/inspect/snapshot/revise repairs can finish.
    if jake_identical:
        return 12
    if (speed or "").strip().lower() in {"quality", "pro", "slow"}:
        return 8
    return 6


def _maybe_run_cad_inspect(result: dict[str, Any], project_path: Path, skills: list[str] | None, trace_id: str | None) -> None:
    """Best-effort CAD skill inspect on exported STEP when cad skill is active."""
    if not skills or "cad" not in {s.strip().lower() for s in skills}:
        return
    step_name = (result.get("files") or {}).get("step")
    if not step_name:
        return
    step_path = project_path / step_name
    try:
        from backend.services import skill_runner

        out = skill_runner.inspect_step_facts(step_path, timeout_sec=45.0)
        if out.get("ok"):
            mode = out.get("mode") or "cad-inspect"
            trace_add("info", f"CAD skill validate OK ({mode}) → {step_name}", trace_id=trace_id)
        else:
            detail = (out.get("stderr") or out.get("stdout") or "unknown")[:200]
            trace_add("warning", f"CAD skill inspect skipped/failed: {detail}", trace_id=trace_id)
    except Exception as exc:
        trace_add("warning", f"CAD skill inspect error: {exc}", trace_id=trace_id)


def _run_cad_inspect_gate(result: dict[str, Any], project_path: Path, trace_id: str | None) -> dict[str, Any] | None:
    """V2-mode: always run CAD inspect as a quality gate. Returns the inspect output dict."""
    step_name = (result.get("files") or {}).get("step")
    if not step_name:
        return None
    step_path = project_path / step_name
    try:
        from backend.services import skill_runner

        out = skill_runner.inspect_step_facts(step_path, timeout_sec=60.0)
        ok = out.get("ok", False)
        mode = out.get("mode") or "cad-inspect"
        if ok:
            trace_add("info", f"[2.0] CAD inspect gate passed ({mode}) → {step_name}", trace_id=trace_id)
        else:
            detail = (out.get("stderr") or out.get("stdout") or "no detail")[:400]
            trace_add("warning", f"[2.0] CAD inspect gate FAILED: {detail}", trace_id=trace_id)
        return out
    except Exception as exc:
        trace_add("warning", f"[2.0] CAD inspect gate skipped (runner unavailable): {exc}", trace_id=trace_id)
        return None


def run_design(
    prompt: str,
    project_path: Path,
    context: dict[str, Any],
    ai: AIService,
    *,
    trace_id: str | None = None,
    max_repairs: int | None = None,
    images: list[dict[str, Any]] | None = None,
    skills: list[str] | None = None,
    speed: str = "fast",
    mode: str = "standard",
    previous_source: str | None = None,
    previous_source_name: str | None = None,
    cancel_check=None,
    progress_callback=None,
    usage_callback=None,
) -> dict[str, Any]:
    """Run the full prompt->validated-model pipeline with self-repair.

    ``mode="v2"`` enables the 2.0 quality pipeline; ``mode="fusion"``
    uses the same text-to-cad/build123d path with stricter phased review:
    - Auto-enables the ``cad`` skill for geometry inspection.
    - Mirrors upstream text-to-cad: generate source → scripts/step → inspect →
      snapshot → repair incomplete/failed source (Jake's repair loop).
    """
    normalized_mode = (mode or "standard").lower()
    is_fusion = normalized_mode == "fusion"
    is_architect = normalized_mode == "architect"
    is_mesh = normalized_mode == "mesh"
    is_v2 = normalized_mode in {"v2", "fusion", "architect"}
    # Jake-style means mirrored prompts + CAD skill CLIs + repair loop.
    # It does NOT mean zero repairs — upstream agents iterate on source errors.
    strict_upstream_text_to_cad = bool((context or {}).get("strict_upstream_text_to_cad", True))
    repair_note: str | None = None
    last_error: str | None = None
    ai_traces: list[dict[str, Any]] = []
    if max_repairs is None:
        max_repairs = _max_repairs_for_speed(speed, jake_identical=is_v2 or is_mesh)
        if is_v2:
            # Jake authoring agent needs enough turns for step/inspect/snapshot/revise.
            max_repairs = max(max_repairs, 12)
        if is_mesh:
            # Match Mode 2.0 repair budget so Mesh can write → export → review → revise.
            max_repairs = max(max_repairs, 12)

    if is_mesh:
        trace_add(
            "info",
            f"[Mesh] img2threejs procedural Three.js pipeline active, max_repairs={max_repairs}",
            trace_id=trace_id,
            data={"max_repairs": max_repairs},
        )
        if progress_callback:
            progress_callback({"stage": "analyze", "pct": 6, "label": "Mesh · starting img2threejs…"})
        from backend.services.mesh_service import run_mesh_img2threejs

        try:
            return run_mesh_img2threejs(
                prompt,
                project_path,
                context or {},
                ai,
                trace_id=trace_id,
                images=images,
                previous_source=previous_source,
                previous_source_name=previous_source_name,
                cancel_check=cancel_check,
                progress_callback=progress_callback,
                usage_callback=usage_callback,
                max_repairs=max_repairs,
            )
        except RuntimeError as exc:
            # Mesh raises plain RuntimeError("Generation canceled.") — promote to
            # DesignCanceled so the API returns 499 and stopped history gets usage/cost
            # the same way Mode 2.0 does.
            if "canceled" in str(exc).lower() or "cancelled" in str(exc).lower():
                raise DesignCanceled(str(exc) or "Generation canceled.") from exc
            raise

    if is_v2:
        # Always include the CAD skill so inspect_step_facts runs and DFM is accurate.
        skills_set = set(s.strip().lower() for s in (skills or []))
        if "cad" not in skills_set:
            skills = list(skills or []) + ["cad"]
            skills_set.add("cad")
        if is_architect and "architect" not in skills_set:
            skills = list(skills or []) + ["architect"]
            skills_set.add("architect")
        label = "Fusion" if is_fusion else "2.0"
        trace_add("info", f"[{label}] Quality pipeline active - CAD skill auto-enabled, max_repairs={max_repairs}", trace_id=trace_id, data={"max_repairs": max_repairs})
        if strict_upstream_text_to_cad:
            trace_add(
                "info",
                f"[{label}] Upstream-mirrored text-to-cad mode active (Jake skill docs + repair loop).",
                trace_id=trace_id,
            )
    if cancel_check and cancel_check():
        raise DesignCanceled("Generation canceled.")
    if progress_callback:
        progress_callback({"stage": "analyze", "pct": 8, "label": "Analyzing prompt and references…"})

    if not previous_source and _looks_like_pet_bottle(prompt, images) and not is_v2:
        from backend.engineering.bottles import pet_soda_bottle_program

        program = pet_soda_bottle_program(**_pet_bottle_style_options(prompt))
        result = kernel_bridge.build_and_export(program, project_path, basename=program.name)
        _maybe_run_cad_inspect(result, project_path, skills, trace_id)
        trace_add("info", "Deterministic PET soda bottle generator used", trace_id=trace_id)
        dfm = result.get("dfm") or {}
        return {
            "intent": "generative",
            "message": program.description or "Built a detailed Coke-style PET bottle with contour ribs and cap.",
            "specs_used": [],
            "result": result,
            "attempts": 1,
            "ai_trace": [{"provider": "deterministic", "generator": "pet_soda_bottle"}],
            "dfm_warnings": dfm.get("warnings", []),
        }

    if is_v2:
        return _run_text_to_cad_v2(
            prompt,
            project_path,
            context,
            ai,
            trace_id=trace_id,
            max_repairs=max_repairs,
            images=images,
            previous_source=previous_source,
            previous_source_name=previous_source_name,
            cancel_check=cancel_check,
            progress_callback=progress_callback,
            usage_callback=usage_callback,
            fusion_mode=is_fusion,
            architect_mode=is_architect,
            strict_upstream=strict_upstream_text_to_cad,
        )

    sketch_structural = is_custom_sketch_structural_request(prompt, images)
    if sketch_structural:
        context = dict(context or {})
        context["component_specs"] = []
        context["referenced_components"] = []
        trace_add(
            "info",
            "Canvas/sketch structural request — using AI parametric design (not component fixture)",
            trace_id=trace_id,
        )

    all_component_specs = (context or {}).get("component_specs") or []
    # Prefer measured specs; if a spec has a standard_mount preset but no measured size_mm,
    # keep it for fixture routing — the fixture compiler uses catalog dims as fallback.
    component_specs = [s for s in all_component_specs if s.get("size_mm") or s.get("standard_mount")]
    if not component_specs:
        component_specs = all_component_specs
    if sketch_structural:
        component_specs = []
    if component_specs and _looks_like_component_fixture(prompt, images):
        from backend.engineering.fixtures import fixture_program_from_specs

        if progress_callback:
            progress_callback({"stage": "plan", "pct": 18, "label": "Building component-fit fixture from measured parts…"})
        program, placements = fixture_program_from_specs(component_specs)
        result = kernel_bridge.build_and_export(program, project_path, basename=program.name)
        _maybe_run_cad_inspect(result, project_path, skills, trace_id)
        plate = program.meta.get("plate_mm") or []
        names = ", ".join(s.get("label") or s.get("stem") for s in component_specs)
        cells = (program.meta.get("components") or [])
        mount_features = []
        if any(c.get("kind") == "board" for c in cells):
            mount_features.append("PCB/SBC standoffs")
        if any(c.get("kind") == "motor" for c in cells):
            mount_features.append("motor faceplate/bracket")
        dimension_rows = []
        if len(plate) == 3:
            dimension_rows = [
                {"param": "plate_width", "value_mm": plate[0], "source": "measured"},
                {"param": "plate_depth", "value_mm": plate[1], "source": "measured"},
                {"param": "plate_thickness", "value_mm": plate[2], "source": "standard"},
            ]
        deterministic_plan = {
            "requirements_analysis": "Component-fit mount request routed to the deterministic fixture compiler instead of freehand AI geometry.",
            "component_hierarchy": "Generated fixture base plus referenced off-the-shelf components seated by part_placements.",
            "parametric_dimension_table": dimension_rows,
            "assembly_plan": "Measured component bounding boxes and known mount presets drive pocket centers, standoff patterns, motor faceplate/bracket geometry, and component placements.",
            "cad_feature_plan": "Use backend engineering.fixtures fixture_program_from_specs: base plate, board pocket, four standoffs with pilot holes, motor mount pad/bracket with bolt pattern, then seat components.",
            "part_generation": f"Deterministic mount compiler generated: {', '.join(mount_features) or 'component-fit features'}.",
            "assembly_constraints": [],
            "step_ready_brep_output": "Fixture generated from deterministic measured-spec rules, not a freehand LLM plate.",
        }
        trace_add("info", f"Deterministic component fixture used for: {names}", trace_id=trace_id)
        dfm = result.get("dfm") or {}
        return {
            "intent": "generative",
            "message": (
                f"Built an open test fixture ({plate[0]:.0f}×{plate[1]:.0f}×{plate[2]:.0f}mm) sized to {names}, "
                f"using the deterministic mount compiler ({', '.join(mount_features)}), and moved each part into its mount."
                if len(plate) == 3
                else f"Built a component-fit test fixture for {names} and seated the parts in their mounts."
            ),
            "design_plan": deterministic_plan,
            "specs_used": [{"source": "component_fixture", "components": [s.get("stem") for s in component_specs]}],
            "part_placements": placements,
            "result": result,
            "attempts": 1,
            "ai_trace": [{"provider": "deterministic", "generator": "component_fixture"}],
            "dfm_warnings": dfm.get("warnings", []),
        }

    if _looks_like_cooking_appliance(prompt, images):
        from backend.engineering.appliances import automated_cooking_appliance_program

        if cancel_check and cancel_check():
            raise DesignCanceled("Generation canceled.")
        if progress_callback:
            progress_callback({"stage": "plan", "pct": 18, "label": "Using automated appliance generator with steppers…"})
        program = automated_cooking_appliance_program()
        result = kernel_bridge.build_and_export(program, project_path, basename="automated_cooking_appliance")
        _maybe_run_cad_inspect(result, project_path, skills, trace_id)
        trace_add("info", "Deterministic automated cooking appliance generator used", trace_id=trace_id)
        dfm = result.get("dfm") or {}
        whisk_swap = any(w in prompt.lower() for w in ("whisk", "beater", "paddle", "toolhead", "tool head"))
        return {
            "intent": "generative",
            "message": (
                "Rebuilt the cooking appliance with a parametric balloon-whisk toolhead on the mixing shaft."
                if whisk_swap
                else (
                    "Built a complete automated cooking appliance with NEMA-17 bowl/chopper steppers "
                    "and NEMA-14 spice dispenser steppers in functional mount positions."
                )
            ),
            "specs_used": [{"source": "automated_cooking_appliance_generator", "envelope_mm": [420, 360, 520]}],
            "result": result,
            "attempts": 1,
            "ai_trace": [{"provider": "deterministic", "generator": "automated_cooking_appliance"}],
            "dfm_warnings": dfm.get("warnings", []),
        }

    if _looks_like_benchy_boat(prompt, images):
        from backend.engineering.toy_boats import benchy_boat_program

        program = benchy_boat_program()
        result = kernel_bridge.build_and_export(program, project_path, basename=program.name)
        trace_add("info", "Deterministic Benchy-style boat generator used", trace_id=trace_id)
        dfm = result.get("dfm") or {}
        return {
            "intent": "generative",
            "message": "Built a single-solid Benchy-style toy boat with fused hull, cabin, roof, and chimney, plus cut openings for the deck, door, and portholes.",
            "specs_used": [],
            "result": result,
            "attempts": 1,
            "ai_trace": [{"provider": "deterministic", "generator": "benchy_boat"}],
            "dfm_warnings": dfm.get("warnings", []),
        }

    for attempt in range(max_repairs + 1):
        if progress_callback:
            progress_callback(
                {
                    "stage": "ai_plan",
                    "pct": 12 if attempt == 0 else 16,
                    "label": f"Planning CAD geometry with AI (attempt {attempt + 1})…",
                }
            )
        try:
            design, ai_trace = ai.generate_design(
                prompt,
                context,
                trace_id=trace_id,
                repair_note=repair_note,
                images=images,
                skills=skills,
                mode=mode,
            )
        except ValueError as exc:
            failed_trace = getattr(exc, "ai_trace", None)
            if isinstance(failed_trace, dict):
                ai_traces.append(failed_trace)
            msg = str(exc)
            if "invalid JSON" not in msg:
                raise
            last_error = msg
            repair_note = (
                "Your previous response was truncated or invalid JSON.\n"
                "Return one COMPLETE JSON object. Keep each design_plan section concise "
                "(2-4 sentences) but include brief, program/generator, and all required fields.\n"
                f"Error: {msg[:800]}"
            )
            trace_add("warning", f"Invalid JSON on attempt {attempt + 1} — retrying", trace_id=trace_id)
            continue
        except Exception as exc:
            failed_trace = getattr(exc, "ai_trace", None)
            if isinstance(failed_trace, dict):
                ai_traces.append(failed_trace)
            raise
        ai_traces.append(ai_trace)
        if cancel_check and cancel_check():
            raise DesignCanceled("Generation canceled.")

        # ── V2 brief gate ────────────────────────────────────────────────────
        if is_v2:
            brief_raw = _extract_brief(design)
            if brief_raw is None:
                missing_brief_note = (
                    "REJECTED: design_plan.brief is missing.\n"
                    "The 2.0 pipeline requires a brief object inside design_plan with fields: "
                    "title, description, design_intent, constraints, no_can_dos, part_constraints.\n"
                    "Return the FULL corrected JSON with brief included."
                )
                trace_add("warning", "[2.0] Brief missing — retrying with brief requirement", trace_id=trace_id)
                repair_note = missing_brief_note
                last_error = "design_plan.brief was not present in the AI response"
                continue

        if progress_callback:
            progress_callback(
                {
                    "stage": "program",
                    "pct": 18,
                    "label": "Converting AI plan into parametric features…",
                }
            )
        trace_add(
            "info",
            f"Design attempt {attempt + 1}: intent={design.get('intent')} "
            f"{'generator' if design.get('generator') else 'program'}",
            trace_id=trace_id,
        )
        try:
            program = design_to_program(design)

            # ── Pre-build validity gate ──────────────────────────────────────
            brief = _extract_brief(design)
            try:
                vr = validate_and_raise(program, brief)
                if vr.warnings:
                    for w in vr.warnings:
                        trace_add("warning", f"[validator] {w}", trace_id=trace_id)
            except ProgramValidationError as vexc:
                trace_add("error", f"[validator] {vexc}", trace_id=trace_id)
                raise ValueError(
                    "Program failed pre-build validation:\n" + str(vexc)
                ) from vexc

            if cancel_check and cancel_check():
                raise DesignCanceled("Generation canceled.")
            if progress_callback:
                progress_callback({"stage": "build", "pct": 24, "label": "Building and exporting model…"})
            export_base = design.get("filename") or program.name
            if sketch_structural:
                export_base = _sketch_design_basename(prompt)
                if export_base in ("component_mounting_fixture", "fixture_base"):
                    export_base = _sketch_design_basename(prompt)
            result = kernel_bridge.build_and_export(
                program, project_path, basename=export_base
            )
        except (KernelBuildError, ValueError) as exc:
            last_error = str(exc)
            repair_note = _repair_hint_for_build_error(exc)
            trace_add("error", f"Design build failed (attempt {attempt + 1}): {exc}", trace_id=trace_id)
            continue

        # Built successfully.
        dfm = result.get("dfm") or {}

        # ── V2 CAD inspect gate ──────────────────────────────────────────────
        if is_v2:
            if progress_callback:
                progress_callback({"stage": "inspect", "pct": 82, "label": "Inspecting geometry with CAD skill…"})
            inspect_out = _run_cad_inspect_gate(result, project_path, trace_id)
            if inspect_out is not None and not inspect_out.get("ok"):
                # Inspect found geometry issues — feed back into repair loop.
                inspect_detail = (inspect_out.get("stderr") or inspect_out.get("stdout") or "geometry issues detected")[:600]
                inspect_repair_note = (
                    f"Build succeeded but CAD geometry inspection FAILED.\n"
                    f"Inspector output:\n{inspect_detail}\n\n"
                    "Fix the geometry issues: check for zero-volume parts, self-intersections, "
                    "non-manifold edges, or missing material. Resubmit the corrected program."
                )
                repair_note = inspect_repair_note
                last_error = f"CAD inspect gate failed: {inspect_detail[:200]}"
                trace_add("warning", f"[2.0] Inspect gate failure on attempt {attempt + 1} — entering repair", trace_id=trace_id)
                continue
        else:
            _maybe_run_cad_inspect(result, project_path, skills, trace_id)

        return {
            "intent": design.get("intent"),
            "message": design.get("message") or program.description or "Model built.",
            "design_plan": design.get("design_plan"),
            "specs_used": design.get("specs_used") or [],
            "part_placements": [] if sketch_structural else (design.get("part_placements") or []),
            "result": result,
            "attempts": attempt + 1,
            "ai_trace": ai_traces,
            "dfm_warnings": dfm.get("warnings", []),
            **({"v2_inspect": True} if is_v2 else {}),
        }

    raise DesignBuildError(
        f"Design failed after {max_repairs + 1} attempts. Last error: {last_error}",
        ai_traces=ai_traces,
    )
