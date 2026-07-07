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
import re
import ast
import base64
import json
from pathlib import Path
from typing import Any

from backend.kernel.errors import KernelBuildError
from backend.kernel.schema import DesignBrief, FeatureProgram
from backend.kernel.validator import ProgramValidationError, validate_and_raise
from backend.services import cad_service, kernel_bridge
from backend.services.ai_service import AIService
from backend.services.trace_log import add as trace_add

logger = logging.getLogger(__name__)


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
    star_import_roots: set[str] = set()
    for node in tree.body:
        if isinstance(node, ast.ImportFrom):
            if any(alias.name == "*" for alias in node.names):
                star_import_roots.add((node.module or "").split(".")[0])

    referenced: set[str] = set()
    for node in ast.walk(gen_step):
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load):
            referenced.add(node.id)

    skip = set(dir(__builtins__)) | {"True", "False", "None"}
    if "build123d" in star_import_roots:
        # Star import supplies the CAD API; only enforce local helpers/constants.
        return sorted(
            name
            for name in referenced
            if name not in defined
            and name not in skip
            and (name.startswith("_") or name in _DXF_CONFIG_NAMES or name.endswith("_layer"))
        )

    return sorted(name for name in referenced if name not in defined and name not in skip)


def _canonical_dxf_extrude_source(
    dxf_filename: str,
    *,
    thickness: float = 25.0,
    label: str = "dxf_model",
) -> str:
    """Minimal proven build123d source for importing a project DXF and extruding it."""
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
        "            add(import_dxf(str(Path(dxf_filename))))\n"
        "            make_face()\n"
        "        extrude(amount=model_thickness)\n"
        "    body = part_builder.part\n"
        "    body.label = solid_label\n"
        "    return body\n"
    )


def _maybe_rewrite_incomplete_dxf_source(
    source: str,
    *,
    dxf_filename: str,
    prompt: str,
) -> tuple[str, str | None]:
    """Replace truncated DXF helper scripts with the canonical import_dxf extrude path."""
    undefined = _gen_step_local_undefined_names(source)
    if not undefined:
        return source, None

    helper_missing = any(name.startswith("_") for name in undefined)
    config_missing = any(name in _DXF_CONFIG_NAMES or name.endswith("_layer") for name in undefined)
    uses_custom_dxf_parser = any(
        token in source
        for token in (
            "_collect_dxf_geometry",
            "_make_outline_body",
            "_largest_closed_face",
            "_apply_cut_polygons",
            "_apply_add_polygons",
        )
    )

    if helper_missing or config_missing or uses_custom_dxf_parser:
        thickness = 25.0
        for match in re.finditer(r"(?<!\d)(\d+(?:\.\d+)?)\s*(?:mm|millimeter|millimeters)\b", prompt or "", re.I):
            try:
                thickness = float(match.group(1))
                break
            except ValueError:
                continue
        label = "mold_from_dxf" if re.search(r"\bmold\b", prompt or "", re.I) else "dxf_model"
        note = (
            "Rewrote incomplete DXF source to the canonical import_dxf() + extrude() template because "
            f"gen_step() referenced undefined names: {', '.join(undefined[:8])}"
            f"{'...' if len(undefined) > 8 else ''}."
        )
        return _canonical_dxf_extrude_source(dxf_filename, thickness=thickness, label=label), note

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

    rewritten, rewrite_note = _maybe_rewrite_incomplete_dxf_source(
        source,
        dxf_filename=primary,
        prompt=prompt,
    )
    if rewrite_note:
        logger.info(rewrite_note)
    return rewritten


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
        if requested and size and not axis_requested:
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
    source_lower = source.lower()
    has_functional_detail = any(token in source_lower for token in ("slot", "rail", "rib", "boss", "hole", "fillet", "chamfer", "trapezoid", "dovetail", "clearance"))
    if functional and ((face_count > 0 and face_count < 36) or not has_functional_detail):
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
            "- The default unit is one complete room module at a time. A room must include separate pieces: floor slab, north/south/east/west wall panels, at least one door/opening, at least one window when reasonable, trim/baseboards, corner connectors, and ceiling/roof attachment sockets.\n"
            "- Never fuse the room into one solid. Keep floors, walls, windows, doors, trims, and connectors as distinct named components/bodies so Render3D can select and edit one wall at a time.\n"
            "- Room output contract: include named/selectable pieces for room_floor, wall_north, wall_south, wall_east, wall_west, corner_connectors, baseboard_trim, roof/ceiling sockets, and separate window/door inserts when present.\n"
            "- House output contract: if the user asks for a house, produce a kit of separate editable bodies, not a monolith. Each wall must be independently movable/resizable with its own length, label, snap endpoints, connector metadata, and printable mating features.\n"
            "- Starter house recipe: one or two floor slabs, separate exterior wall panels, optional interior divider wall, corner pillars/posts, one framed front door, at least two framed blue-glass windows, separate roof panels/caps, and an open/cutaway side or removable roof so it reads as a house layout.\n"
            "- Make the preview read as a house room: leave one wall open, lowered, or cut away unless the user asks for a sealed module; add wall thickness, baseboards, sill/lintel parts, trim frames, panel seams, and recognizable window/door inserts.\n"
            "- Generate reusable modules: room bays, wall panels, window inserts, door panels, roof/ceiling modules, floor slabs, corner connectors, stairs, and service cores.\n"
            "- For wall-level edits from Architect ribbon tools, preserve the selected wall as its own piece and only modify that wall plus separate child parts such as window_insert, door_insert, sill, lintel, trim, rails, connectors, or generative details.\n"
            "- Include print-friendly snap interfaces: chunky tabs, sockets, rails, alignment keys, peg/hole connectors, dovetail-like guides, corner posts, chamfered lead-ins, and 0.2-0.4 mm prototype clearance notes when relevant. Make them visible, named, grid-aligned, and not fragile.\n"
            "- Add robot assembly intent in source comments and labels: pick points, oversized lift tabs, grip flats, lift holes, assembly order, connector side, mating target, and orientation labels like TOP/INSIDE/NORTH.\n"
            "- Apply house-like visual materials/colors: warm wood/tan floor, light wall/plaster panels, darker roof, blue glass inserts, and contrasting trim/connectors.\n"
            "- Keep STEP-valid solids with semantic labels. Prefer assemblies/compounds of named parts when the user asks for multiple modules.\n"
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
            _validate_generated_source(source)
            source = _augment_text_to_cad_source(
                source,
                context=context,
                project_path=project_path,
                prompt=prompt,
            )
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
            if source_path.is_file():
                try:
                    current_source = source_path.read_text(encoding="utf-8", errors="ignore")
                except Exception:
                    pass
            repair_note = f"Source generation failed: {last_error}"
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
        step_out = skill_runner.run_skill_tool(
            "cad",
            "step",
            [
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
            ],
            cwd=project_path,
            timeout_sec=240.0,
        )
        if not step_out.get("ok"):
            detail = _error_tail(step_out, "scripts/step failed")
            last_error = detail
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
                "parts": [],
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
    """Return extra repair attempts beyond the first try (0 = one attempt only)."""
    return 0


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
