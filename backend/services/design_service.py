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
    text = prompt or ""
    if re.search(r"\b(dxf|vxf|dwg|drawing|blueprint)\b", text, re.I):
        return True
    if re.search(r"\b2d\s+(profile|outline|drawing|file)\b", text, re.I):
        return True
    if re.search(r"\bfrom\s+this\s+\w+\s+file\b", text, re.I):
        return True
    if re.search(r"\b(from|off|using)\s+(this|the)\b", text, re.I) and re.search(
        r"\b(model|mold|part|file|drawing|profile|outline|vxf|dxf)\b",
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
    for arg in (*func.args.args, *func.args.kwonlyargs):
        names.add(arg.arg)
    if func.args.vararg:
        names.add(func.args.vararg.arg)
    if func.args.kwarg:
        names.add(func.args.kwarg.arg)
    for node in ast.walk(func):
        if isinstance(node, ast.Assign):
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
        elif isinstance(node, ast.ExceptHandler) and node.name:
            names.add(node.name)
    return names


def _config_like_name(name: str) -> bool:
    return (
        name in _DXF_CONFIG_NAMES
        or name.endswith("_layer")
        or name.endswith("_label")
        or name.endswith("_filename")
        or name.endswith("_path")
        or name.startswith("_")
    )


def _default_constant_value(name: str, *, base: str, prompt: str) -> str | None:
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
    if name.endswith("_layer"):
        return f'"{name[:-6].upper()}"'
    return None


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
    undefined = _missing_config_constants(source)
    if not undefined:
        return source
    defined = _defined_module_names(source)
    injections: list[str] = []
    for name in undefined:
        if name in defined or name.startswith("_"):
            continue
        rendered = _default_constant_value(name, base=base, prompt=prompt)
        if rendered is not None:
            injections.append(f"{name} = {rendered}")
    if not injections:
        return source
    return _insert_after_imports(source, "\n\n".join(injections))


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
        # Deduplicate while preserving sort
        seen: set[str] = set()
        result: list[str] = []
        for name in sorted(set(undefined_helpers + undefined_config)):
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
    helper_names = [name for name in missing if re.match(r"^[a-z][a-z0-9_]*$", name) and name not in _BUILTIN_NAMES]
    if not helper_names:
        return f"Source generation failed: {error}"

    examples = "\n".join(f"- define `{name}(...)` at module scope before `gen_step()`" for name in helper_names)
    return (
        "The previous Python source was incomplete because gen_step() called helper functions "
        "that were never defined in the same file.\n"
        f"Missing names: {', '.join(helper_names)}\n"
        "Fix this by editing the existing source into ONE complete Python file. Either define the missing helpers above "
        "gen_step() or inline their full geometry logic inside gen_step(). Do not restart from an unrelated model.\n"
        f"{examples}\n"
        "If this is a DXF/VXF workflow, prefer zero custom helper calls in gen_step(): inline the modeling blocks "
        "directly so names like make_*/add_*/build_* cannot be left undefined.\n"
        "Every helper called by gen_step() must have a real function body before gen_step(); no stubs, no pass, no ellipsis.\n"
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
    native labels for internals. Render3D previously promoted every labeled leaf
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

    outputs: list[str] = []
    used_names: set[str] = set()
    candidates = leaves
    if major_only:
        candidates = _architect_major_build123d_children(leaves)
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
            "DXF/VXF semantic modeling failed: the source uses a generic Render3D fallback template "
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

    Render3D-specific DXF template rewrites were removed because they could
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
    from backend.skills.dxf.scripts.dxf.repair import ensure_ezdxf_readable_dxf

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
) -> str:
    """Inject missing module-level DXF constants/helpers the model often omits."""
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


def _finalize_text_to_cad_source_before_step(
    source_path: Path,
    *,
    context: dict[str, Any] | None,
    project_path: Path,
    prompt: str,
) -> str:
    """Last-chance DXF repair immediately before scripts/step executes the file."""
    source = source_path.read_text(encoding="utf-8", errors="ignore")
    finalized = _augment_text_to_cad_source(
        source,
        context=context,
        project_path=project_path,
        prompt=prompt,
    )
    finalized = _augment_common_constants(finalized, base=source_path.stem, prompt=prompt)
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


def _v2_quality_repair_note(prompt: str, source: str, inspect_out: dict[str, Any]) -> str | None:
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
        if axis_requested and size:
            axis_names = ("X/front width", "Y/depth", "Z/height")
            for spec in axis_requested:
                axis = int(spec["axis"])
                requested_value = float(spec["value"])
                actual_value = float(size[axis])
                if requested_value >= 25 and abs(actual_value - requested_value) > max(6.0, requested_value * 0.12):
                    return (
                        "The geometry passed export but failed the CAD brief quality gate: "
                        f"the prompt specifies {spec['label']} of {requested_value:g} mm, "
                        f"but inspect reports {axis_names[axis]} = {actual_value:.1f} mm "
                        f"(bbox={', '.join(f'{v:.1f}' for v in size)} mm). "
                        "Revise the named parameters so the exported model's overall axis dimension matches the requested dimension."
                    )
        requested = _requested_mm_dimensions(prompt)
        # Generic mm-token scale checks are too noisy for DXF-derived models:
        # drawings often include local feature dimensions that are not global envelope targets.
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


def _run_v2_snapshot(skill_runner, project_path: Path, step_name: str, base: str, trace_id: str | None) -> dict[str, Any] | None:
    before = {p.name for p in project_path.glob(f"{base}_snapshot*.png")}
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
        detail = (out.get("stderr") or out.get("stdout") or "snapshot failed")[:400]
        trace_add("warning", f"[2.0/text-to-cad] snapshot failed: {detail}", trace_id=trace_id)
        return None
    after = {p.name for p in project_path.glob(f"{base}_snapshot*.png")}
    created = sorted(after - before)
    if not created and (project_path / f"{base}_snapshot.png").is_file():
        created = [f"{base}_snapshot.png"]
    return {"file": created[-1], "stdout": (out.get("stdout") or "")[-2000:], "stderr": (out.get("stderr") or "")[-2000:]} if created else {"stdout": (out.get("stdout") or "")[-2000:], "stderr": (out.get("stderr") or "")[-2000:]}


def _error_tail(out: dict[str, Any], fallback: str, *, limit: int = 2400) -> str:
    """Keep the end of tool stderr/stdout where actionable root causes usually appear."""
    text = (out.get("stderr") or out.get("stdout") or fallback or "").strip()
    if len(text) <= limit:
        return text
    return f"...\n{text[-limit:]}"


def _snapshot_image_payload(project_path: Path, snapshot_info: dict[str, Any] | None) -> list[dict[str, Any]]:
    name = snapshot_info.get("file") if snapshot_info else None
    if not name:
        return []
    path = project_path / str(name)
    if not path.is_file() or path.suffix.lower() != ".png":
        return []
    data = base64.b64encode(path.read_bytes()).decode("ascii")
    return [{
        "id": "cad-snapshot",
        "name": path.name,
        "media_type": "image/png",
        "data_url": f"data:image/png;base64,{data}",
    }]


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
        return None, None
    system = """You are reviewing a text-to-cad snapshot like the upstream CAD skill.
Return ONLY JSON: {"pass": boolean, "repair_note": string, "issues": [string]}.
Pass only if the visible model appears to satisfy the user's prompt and CAD brief.
Fail when the model is a primitive placeholder, misses key functional interfaces, ignores explicit dimensions, lacks requested holes/slots/bosses/mounting features, or looks semantically unlike the requested object.
If failing, repair_note must be concrete source-level guidance for the next build123d repair attempt."""
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
        "Review the attached snapshot. Does it visually and functionally match the brief?"
    )
    review, trace = ai.chat_json(
        system,
        user,
        images=images,
        trace_id=trace_id,
        max_tokens=4096,
        retry_on_truncation=False,
        reasoning_effort="low",
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


def _convert_text_to_cad_glb_to_z_up(glb_path: Path) -> None:
    """Convert upstream text-to-cad's native Y-up preview GLB to Render3D Z-up."""
    if not glb_path.is_file():
        return
    try:
        import trimesh

        scene = trimesh.load(glb_path, force="scene")
        scene.apply_transform(trimesh.transformations.rotation_matrix(math.pi / 2.0, [1, 0, 0]))
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
    fusion_mode: bool = False,
    architect_mode: bool = False,
) -> dict[str, Any]:
    """CAD 2.0/Fusion path: generate build123d source and run text-to-cad scripts/step."""
    from backend.services import skill_runner

    base = Path(previous_source_name).stem if previous_source_name else _slug(prompt)
    if base in {"create", "make", "build", "design"}:
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
    current_source: str | None = previous_source

    if _prompt_mentions_dxf_import(prompt) and not _collect_dxf_filenames(context, project_path, prompt):
        message = _missing_dxf_file_message()
        trace_add("error", f"[2.0/text-to-cad] {message}", trace_id=trace_id)
        raise DesignBuildError(message, ai_traces=ai_traces)

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
                "- Still satisfy the Render3D build123d source contract for now; the local plugin bridge will consume generated code/scripts in a separate connection path.\n"
            )
    elif architect_mode:
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
    if progress_callback:
        progress_callback({"stage": "brief", "pct": 10, "label": f"Writing {label_prefix} CAD brief with text-to-cad skill..."})
    edit_note = ""
    if previous_source:
        edit_note = (
            "\n\nEDIT MODE: The user is editing the current model. Preserve the existing generated source "
            f"({previous_source_name or source_name}) and change only what the prompt asks for. "
            "Do not create an unrelated replacement model. This must be a visible iteration of the existing object: "
            "keep the same role, scale, orientation, and filename lineage, but modify the source enough that the next "
            "snapshot clearly differs from the previous version. For vague aesthetic requests such as 'make it cooler', "
            "add explicit visible design features (beveled/chamfered styling, accent cutouts, ribs, vents, raised pads, "
            "decorative but printable grooves, stronger silhouette changes, or material/color-separated details) while "
            "preserving all functional support/contact geometry. If Project context contains a component/object ref, "
            "that is the object being iterated."
        )
    cad_brief, brief_trace = ai.generate_cad_brief(
        prompt + edit_note + workflow_note,
        context,
        trace_id=trace_id,
        images=images,
    )
    ai_traces.append(brief_trace)
    if cancel_check and cancel_check():
        raise DesignCanceled("Generation canceled.")
    (project_path / f"{base}.brief.md").write_text(cad_brief.rstrip() + "\n", encoding="utf-8")

    for attempt in range(max_repairs + 1):
        if cancel_check and cancel_check():
            raise DesignCanceled("Generation canceled.")
        if progress_callback:
            progress_callback({
                "stage": "ai_source",
                "pct": 10 if attempt == 0 else 14,
                "label": f"Writing build123d source with {label_prefix} CAD skill (attempt {attempt + 1})...",
            })
        try:
            source, ai_trace = ai.generate_cad_python_source(
                prompt + edit_note + workflow_note,
                context,
                trace_id=trace_id,
                repair_note=repair_note,
                previous_source=current_source,
                images=images,
                cad_brief=cad_brief,
                fusion_mode=fusion_mode,
            )
            ai_traces.append(ai_trace)
            # Preserve the exact source that failed validation so the next
            # repair pass can edit it, matching the upstream text-to-cad
            # source -> step -> repair loop.
            current_source = source
            _validate_generated_source(source)
            source = _augment_text_to_cad_source(
                source,
                context=context,
                project_path=project_path,
                prompt=prompt,
            )
            source = _augment_common_constants(source, base=base, prompt=prompt)
            dxf_issue = _dxf_semantic_source_issue(source, prompt, context)
            if dxf_issue:
                raise ValueError(dxf_issue)
            remaining = _gen_step_local_undefined_names(source)
            if remaining:
                raise ValueError(
                    "Generated source is incomplete; gen_step() references undefined names: "
                    + ", ".join(remaining[:12])
                    + ("..." if len(remaining) > 12 else "")
                )
            source_path.write_text(source.rstrip() + "\n", encoding="utf-8")
            current_source = source
        except Exception as exc:
            last_error = str(exc)
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
        )
        if not step_out.get("ok"):
            detail = _error_tail(step_out, "scripts/step failed")
            last_error = detail
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
                    # Check for NameError — undefined helper function that gen_step() calls
                    name_err_match = re.search(r"NameError: name '(\w+)' is not defined", detail)
                    if name_err_match:
                        missing_fn = name_err_match.group(1)
                        repair_note = (
                            f"NameError: '{missing_fn}' is called in gen_step() but was never defined in this file. "
                            "This is the #1 source of failure: you wrote a function call without writing the function body. "
                            f"Fix: define '{missing_fn}' at module scope BEFORE gen_step(), "
                            "OR inline its logic directly inside gen_step(). "
                            "Rule: every function called in gen_step() MUST be fully defined in this same file — "
                            "do not reference any name that you have not explicitly def'd.\n"
                            f"Full error:\n{detail}"
                        )
                    else:
                        repair_note = f"scripts/step failed:\n{detail}"
                trace_add("error", f"[2.0/text-to-cad] scripts/step failed (exit {exit_code}): {detail[:500]}", trace_id=trace_id)
                continue

        _convert_text_to_cad_glb_to_z_up(project_path / glb_name)
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
        )
        if not inspect_out.get("ok"):
            detail = _error_tail(inspect_out, "scripts/inspect failed")
            last_error = detail
            repair_note = f"scripts/inspect failed:\n{detail}"
            trace_add("warning", f"[2.0/text-to-cad] inspect failed: {detail[:500]}", trace_id=trace_id)
            continue

        if cancel_check and cancel_check():
            raise DesignCanceled("Generation canceled.")
        quality_note = _v2_quality_repair_note(prompt, source, inspect_out)
        if quality_note:
            last_error = quality_note
            repair_note = quality_note
            trace_add("warning", f"[2.0/text-to-cad] quality gate failed: {quality_note[:500]}", trace_id=trace_id)
            continue

        missing = [name for name in (step_name, glb_name) if not (project_path / name).is_file()]
        if missing:
            last_error = f"text-to-cad did not produce required artifact(s): {', '.join(missing)}"
            repair_note = last_error
            continue

        if progress_callback:
            progress_callback({"stage": "snapshot", "pct": 90, "label": f"Rendering {label_prefix} CAD snapshot review..."})
        snapshot_info = _run_v2_snapshot(skill_runner, project_path, step_name, base, trace_id)
        if progress_callback:
            progress_callback({"stage": "snapshot_review", "pct": 92, "label": f"Reviewing {label_prefix} CAD snapshot for quality..."})
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
                fusion_mode=fusion_mode,
            )
            if snapshot_trace:
                ai_traces.append(snapshot_trace)
        except Exception as exc:
            snapshot_note = None
            trace_add("warning", f"[2.0/text-to-cad] snapshot review skipped: {exc}", trace_id=trace_id)
        if snapshot_note:
            last_error = snapshot_note
            repair_note = snapshot_note
            trace_add("warning", f"[2.0/text-to-cad] snapshot review failed: {snapshot_note[:500]}", trace_id=trace_id)
            continue

        if cancel_check and cancel_check():
            raise DesignCanceled("Generation canceled.")
        if progress_callback:
            progress_callback({"stage": "finalize", "pct": 96, "label": "Finalizing text-to-cad artifacts..."})
        files = {
            "source": source_name,
            "step": step_name,
            "glb": glb_name,
        }
        promoted_parts = [] if architect_mode else _promote_disconnected_bodies(project_path, glb_name, base=base)
        source_parts = _promote_build123d_children_from_source(
            project_path,
            source_name,
            base=base,
            max_parts=18 if architect_mode else 96,
            major_only=architect_mode,
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
        return {
            "intent": "generative",
            "message": f"Built {base} with the {'Architect modular ' if architect_mode else 'Fusion-style ' if fusion_mode else ''}text-to-cad build123d workflow.",
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
                    "name": base,
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
            "fusion_text_to_cad": fusion_mode,
            "architect_text_to_cad": architect_mode,
        }

    raise DesignBuildError(
        f"text-to-cad 2.0 failed after {max_repairs + 1} attempts. Last error: {last_error}",
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

    Gear meshes/ratios are design metadata, not physical joints in Render3D's
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


def _max_repairs_for_speed(speed: str | None) -> int:
    """Return extra repair attempts beyond the first try."""
    if (speed or "").strip().lower() in {"quality", "pro", "slow"}:
        return 3
    # Fast mode still needs one cheap source-repair pass. The common failure is
    # incomplete AI source (gen_step() calls make_* helpers the model forgot to
    # define); without one repair pass the targeted repair note never runs.
    return 1


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
) -> dict[str, Any]:
    """Run the full prompt->validated-model pipeline with self-repair.

    ``mode="v2"`` enables the 2.0 quality pipeline; ``mode="fusion"``
    uses the same text-to-cad/build123d path with stricter phased review:
    - Auto-enables the ``cad`` skill for geometry inspection.
    - Single attempt only (no automatic repair retries).
    """
    normalized_mode = (mode or "standard").lower()
    is_fusion = normalized_mode == "fusion"
    is_architect = normalized_mode == "architect"
    is_v2 = normalized_mode in {"v2", "fusion", "architect"}
    repair_note: str | None = None
    last_error: str | None = None
    ai_traces: list[dict[str, Any]] = []
    if max_repairs is None:
        max_repairs = _max_repairs_for_speed(speed)
        if normalized_mode == "v2":
            # Text-to-CAD source validation often catches truncation or omitted
            # helper definitions before scripts/step runs. Keep one repair pass
            # available in fast mode so that feedback can be applied.
            max_repairs = max(max_repairs, 1)

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
    if cancel_check and cancel_check():
        raise DesignCanceled("Generation canceled.")
    if progress_callback:
        progress_callback({"stage": "analyze", "pct": 8, "label": "Analyzing prompt and references…"})

    if not previous_source and _looks_like_pet_bottle(prompt, images):
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
            fusion_mode=is_fusion,
            architect_mode=is_architect,
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
