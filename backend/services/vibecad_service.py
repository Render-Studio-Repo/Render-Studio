"""VibeCAD mode: gutted build123d authoring from 10-X-eng/vibecad → Render Studio.

Mirrors how Jake Mode 2.0 was wired: keep the product shell (prompt jobs, viewport,
BYOK LLM), vendor their isolated build123d worker + authoring contract, and publish
STEP → GLB into the existing Three.js viewer.

Mode ``v2`` (Jake) is untouched — this path only runs when ``mode=vibecad``.
"""

from __future__ import annotations

import json
import logging
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Callable, Optional

from backend.services.ai_service import AIService, cad_authoring_max_tokens
from backend.services.cad_harness import format_context_packet, stage_project_drawings
from backend.services.prompt_language import with_multilingual_prompt_rule
from backend.services.parts_sourcing_policy import UNRESOLVED_PURCHASED_INTERFACE_RULES
from backend.services.trace_log import add as trace_add
from backend.services.cad_assembly_contract import CAD_ASSEMBLY_SCOPE_RULES, VIBECAD_RESULT_RULES, validate_assembly_manifest

logger = logging.getLogger(__name__)

ProgressCb = Optional[Callable[[dict[str, Any]], None]]
CancelCb = Optional[Callable[[], bool]]
UsageCb = Optional[Callable[[list[dict[str, Any]]], None]]

# Desktop VibeCAD shows one assembly. Per-part GLBs are live-preview sugar.
_MAX_LIVE_PART_MESHES = 24
# Slicer skill dumps drown Astra/Codex into notes instead of a `result =` program.
_ONESHOT_SKIP_SKILLS = frozenset({"bambu-labs", "gcode"})
_SOURCE_KEYS = ("source", "code", "python", "program", "script", "build123d")
_CONSTRUCT_RE = re.compile(
    r"\b(Box|Cylinder|Cone|Sphere|Wedge|extrude|revolve|loft|sweep|make_face|"
    r"BuildPart|BuildSketch|Part\.)\b"
)


def _vibecad_skills_block(skills: list[str] | None) -> str:
    from backend.services.skills_service import build_skills_prompt

    ids = [str(s).strip().lower() for s in (skills or []) if str(s).strip()]
    ids = [s for s in ids if s not in _ONESHOT_SKIP_SKILLS]
    if "vibecad" not in ids:
        ids.insert(0, "vibecad")
    return build_skills_prompt(ids, compact=True, dialect="vibecad")


def _with_vibecad_skills(system: str, skills: list[str] | None) -> str:
    system = f"{system}\n\n{CAD_ASSEMBLY_SCOPE_RULES}\n{VIBECAD_RESULT_RULES}"
    block = _vibecad_skills_block(skills)
    if not block:
        return system
    return f"{system}\n\n{block}"

VIBECAD_SYSTEM = with_multilingual_prompt_rule("""You are VibeCAD, a principal mechanical design engineer authoring parametric CAD
for Render Studio through an isolated build123d 0.11 sidecar (gutted from 10-X-eng/vibecad).

The current user message is the authority. A simple solid that only resembles the request is a failure.

Write complete build123d Python source that:
- Uses millimetres
- Receives driving dimensions as the `params` dict and optional STEP imports as `inputs`
- Assigns a non-empty ordered dict[str, Shape] to `result`
- Keys of `result` must exactly match `expected_outputs` (same order)
- Each value is a valid single-solid build123d Shape (one independently editable component)
- Makes alignment and placement explicit; assert critical datums / dimensions when useful
- Does NOT import exporters, write files, or call network/IO

Output JSON only, with `source` at the TOP LEVEL (not inside tool/args):
{
  "model_name": "HumanReadableName",
  "source": "<complete python source assigning result>",
  "parameters": {"key": number_or_string, ...},
  "expected_outputs": ["PartA", "PartB"],
  "input_objects": {"alias": "ExactStepFileName.step"},
  "joints": [
    {"id": "lid_hinge", "type": "revolute", "parent": "Base", "child": "Lid", "anchor": [0, 0, 20], "axis": [1, 0, 0], "limits": [0, 110]}
  ]
}

Do not return {"tool":"build123d.create_model","args":{...}} or conversation.review_design.
Do not reply with notes, a design review, or a result dict without a `source` string.
`source` must contain a line `result = { ... }` of named solids.
Return `parts_list` alongside the source when the design uses purchased components. Use one row per unique sourced product purchase URL with the total required quantity. Include sourced motors, wheels, drivers, power supplies, wiring and control boards; put datasheets in docs. Do not list each modeled sub-body, terminal or washer instance separately, reuse a whole robot reference URL for its subparts, or put unsourced/fabricated geometry in the shopping list. Keep all required geometry in the assembly. Put missing product sources, unresolved sizing and mounting requirements in parts_list.questions.

`joints` is required for mechanisms (hinge/lid/arm/gripper/slider/robot). Types match FreeCAD Assembly: fixed, revolute, slider, cylindrical, ball, distance, parallel, perpendicular, angle, rack_pinion, screw, gears, belt. parent/child MUST equal `result` keys (or "world"). anchor millimetres, axis unit vector. The host writes r3d_joints.json and embeds portable joint metadata in STEP; the Fusion import script creates native joints.

Do not return {"tool":"build123d.create_model","args":{...}} or conversation.review_design.
Do not reply with notes, a design review, or a result dict without a `source` string.
`source` must contain a line `result = { ... }` of named solids.
Staged McMaster / sibling STEPs are hardware to mate — never wrap inputs['selected_object']
as the entire NEW model.

`input_objects` is optional. When @-linked STEP files or a dropped CAD file are provided,
map aliases to those exact filenames and load them via `inputs[alias]` in source.
NEW models: `inputs['reference_object']` (or the named sibling alias) is the live B-rep
to model TO — mate the requested geometry to its faces, T-slots, and profiles. Do not rebuild
or replace that solid, and do not invent a generic box in its place.
Prefer mating to linked geometry over reinventing it.
Honor McMaster-Carr / purchased hardware listed in the CAD brief and context unless the user
forbids screws or asks for an all-printed / printer-bed kit:
If print-only, do not import catalog STEPs or reprint fasteners as McMaster stand-ins — use snap-fits.
Otherwise load those STEP/STL files via input_objects (hw_* aliases), include their placed solids in result, and mate the requested parts to them.
If the design needs screws, nuts, washers, bearings, standoffs, inserts, or electronics mounts, use the fetched catalog STEPs. Do not skip hardware because this is VibeCAD rather than Jake — unless the prompt says no screws / all printed.

For a new substantial design, simplify custom fabrication while including every requested
physical component in its assembled pose. There is no arbitrary body-count limit.
Use provisional envelopes for unknown vendor interfaces and record the missing dimensions.
Honor @component / @face / DXF / document links listed in the user packet.
When inputs["selected_object"] or another STEP alias is provided, that value is
already a build123d Shape (the worker imported the STEP). Use it directly —
`from build123d import *` does not define Shape; isinstance(..., Shape) is fine
because the worker injects Shape. Do not import_step() the Shape again.

Hopper / funnel / vessel: one outer silhouette, then revolve or loft
(`Pos(0, 0, z) * Circle(r)` stations), then cut the bore. Do not fuse centered
Cylinder/Cone with .translate((0, 0, z)); that drops the wall. If you stack
primitives, every one needs align=(Align.CENTER, Align.CENTER, Align.MIN) and z
is the BOTTOM of that solid.

Screw / clamp / collar threads: NEVER sweep a trapezoid (or any profile) along
a long `Helix`. That compile times out or SIGSEGV in the sidecar. Model a
printed screw as a cylinder at major diameter with chamfered ends; a nut or
threaded jaw as a hole at minor diameter. Optional cosmetic thread: at most two
annular grooves, or a Helix sweep of ≤2 turns. Fit is clearance, not a 20-turn
solid.

Do not `Torus` a rim and fuse it onto a hollow cup / tube — that SIGSEGVs the
sidecar. Round a rim with a short ring (`Cylinder(R, 2*r) - Cylinder(R-2*r, 2*r)`)
or a fillet. Standalone and partial `Torus` geometry remains native and must
not be replaced with a different cross-section.

When photos or canvas sketches are attached, read them WITH the prompt — do not invent
a box that only resembles one image:
- canvas-sketch.png / line drawings explain spatial intent (arrows, hanging off, beside, offset).
  They are not photos of the finished part.
- Photos of extrusion, rail, frame, or hardware are mate TARGETS. Connect the new part as the
  prompt + canvas show (often cantilevered / off the side). Do not sit the motor on top of the
  extrusion unless the prompt and sketch say on-top.
- Product photos of the thing to make: match that object's silhouette and features.
When DXF / drawing context lists a filename, that file is in the worker cwd. Author the part from
the drawing directly; do not replace a dimensioned drawing with a random catalog look-alike.
Required assembly hardware is different: import fetched McMaster STEPs from the CAD brief / parts list.
Set `dxf_filename = "vision-reference.dxf"` (or the listed readable name).
`from build123d import import_dxf` and `import ezdxf` / `from pathlib import Path` are allowed.
Reconstruct 3D from layers and polylines (outer profiles, holes, pockets). A whole-file
import_dxf()+make_face()+extrude() is only for an explicit flat plate.

Assign realistic material finishes per named part; infer plausible material from function when unspecified. Preserve explicit user/reference colours, authored neutral metals, white paint, textures and transparency. Use srgb("#hex") on leaf solids (aluminum #c0c6cc, steel #8a939d, rubber #303438, brass #c4a574, POM #d9d3c7). Identical parts/materials share a finish. Unknown parts use neutral aluminum; never random, index, or rainbow palettes. Assembled and exploded outputs must share the same material assignments and stable part labels; only transforms change.

Colour every named solid with realistic shop materials from the prompt `colors:` clause
(srgb("#c0c6cc") aluminum, #8a939d steel, #3a3f44 black oxide, #c4a574 brass, #d9d3c7 POM).
Imported STEP/GLB that tessellates white/grey is unauthored — still assign .color / srgb;
do not leave default-white on Target Edit.
""")
VIBECAD_SYSTEM += "\n\n" + UNRESOLVED_PURCHASED_INTERFACE_RULES

VIBECAD_REPAIR_SYSTEM = """You are repairing a VibeCAD build123d program for Render Studio.

Return JSON only with the same schema as creation — source at the top level:
{"model_name","source","parameters","expected_outputs"}

If the previous reply was a tool-call, review, or notes, unwrap it: copy the Python
that assigns `result = { ... }` into top-level `source`. Do not call tools.

Fix the smallest exact cause of the worker failure. Keep working geometry.
Do not invent exporter calls or filesystem writes. Millimetres. result dict keys must
exactly match expected_outputs in order; each value one solid Shape.

Hopper/funnel/vessel: revolve or loft one silhouette. Never
Cylinder/Cone().translate((0,0,z)) without align=(Align.CENTER, Align.CENTER, Align.MIN).
If inputs include selected_object, edit that Shape in place (do not import_step it).
Threads: replace Helix+sweep ridges with a cylinder / bored hole (cosmetic
grooves only, ≤2 turns). Long helical sweeps crash or time out the worker.
Do not fuse Torus rims onto cups — use a short cylinder ring.
"""


def _progress(cb: ProgressCb, stage: str, pct: int, label: str) -> None:
    if cb:
        cb(
            {
                "stage": stage,
                "pct": pct,
                "label": label,
                "thinking": label,
                "activity": [{"text": label, "stage": stage}],
            }
        )


def _slug(value: str, fallback: str = "part") -> str:
    slug = re.sub(r"[^a-zA-Z0-9_]+", "_", str(value or "").strip()).strip("_")
    return slug[:48] or fallback


def _context_brief(context: dict[str, Any] | None, project_path: Path, prompt: str = "") -> str:
    """Serialize Mode 2.0-style @links / DXF / components into the authoring packet."""
    return format_context_packet(context, project_path, prompt=prompt)


HELICAL_THREAD_SWEEP_HINT = (
    "Do not sweep Helix paths for screw/clamp/collar threads. "
    "Long Helix+sweep (trapezoidal ridges over tens of mm) times out or crashes "
    "the build123d worker (SIGSEGV / exit -11). "
    "Model screws as a cylinder at major diameter with chamfered ends; "
    "nuts/collars as a hole at minor diameter. "
    "Optional cosmetic thread: at most two annular grooves or a Helix sweep of ≤2 turns. "
    "Functional engagement is clearance/fit, not a 20-turn solid sweep."
)

WORKER_TIMEOUT_MIN_SEC = 360.0
WORKER_TIMEOUT_MAX_SEC = 1200.0
WORKER_TIMEOUT_PER_SOLID_SEC = 45.0


def _source_has_helical_thread_sweep(source: str) -> bool:
    """True when authored CAD sweeps a profile along Helix for a screw thread."""
    text = str(source or "")
    if not re.search(r"\bHelix\s*\(", text):
        return False
    if not re.search(r"\bsweep\s*\(", text):
        return False
    return bool(re.search(r"\b(thread|pitch|ridge|trapezoid|helix_ridge|helical_rib)\b", text, re.I))


def _lint_vibecad_source(source: str, *, compile_gate: bool = True) -> str | None:
    """Reject hopper stacking and leaked host internals. Helix/Torus compile in the sidecar."""
    text = str(source or "")
    if not text.strip():
        return "VibeCAD source is empty."
    if not re.search(r"(?m)^\s*result\s*=", text):
        return "VibeCAD source must assign `result`."
    stacked = bool(re.search(r"\b(Cylinder|Cone)\s*\(", text))
    z_translate = bool(
        re.search(r"\.translate\(\s*\(\s*0\s*,\s*0\s*,", text)
        or re.search(r"\.translate\(\s*\([^)]{0,40}z", text, re.I)
    )
    pos_prim = bool(re.search(r"Pos\s*\([^)]*\)\s*\*\s*(Cylinder|Cone)\s*\(", text))
    has_min = "Align.MIN" in text
    revolved = bool(re.search(r"\b(revolve|loft)\s*\(", text, re.I))
    hopperish = bool(
        re.search(
            r"\b(hopper|funnel|gore|collar_height|cone_height|throat_height|vessel|bin)\b",
            text,
            re.I,
        )
    )
    if stacked and (z_translate or pos_prim) and not has_min:
        return (
            "VibeCAD skill: Cylinder/Cone default to CENTER. "
            ".translate((0,0,z)) or Pos(0,0,z)*Cylinder moves the center, not the base — "
            "the cone wall disappears. Use align=(Align.CENTER, Align.CENTER, Align.MIN) "
            "with z as the BOTTOM, or revolve/loft one silhouette."
        )
    if hopperish and stacked and not revolved and not has_min:
        return (
            "Hopper/funnel/vessel must be a revolved or lofted silhouette "
            "(Pos(0,0,z)*Circle / Polyline+revolve), not centered Cone().translate()."
        )
    leaked = re.findall(
        r"\b(WORKER|_run_worker|_BACKEND_DIR|_worker_path|uvicorn|sys\.executable)\b",
        text,
    )
    if leaked:
        return (
            "VibeCAD source must not reference studio internals "
            f"({', '.join(dict.fromkeys(leaked))}). "
            "Assign `result` as an OrderedDict of build123d Shapes only. "
            "Do not import or call the build123d worker."
        )
    # Native Helix/sweep and Torus geometry is preserved by the sidecar.
    # compile_gate is reserved for hopper / leaked-host checks; kernel failures
    # are reported by the isolated worker and repaired without substitution.
    _ = compile_gate
    return None


def _project_step_for_name(project_path: Path, name: str | None) -> Path | None:
    supplied = str(name or "").strip()
    raw = Path(supplied).name.strip()
    if not raw:
        return None
    stem = Path(raw).stem
    from backend.services import cad_service

    direct = (Path(project_path) / supplied).resolve()
    try:
        direct.relative_to(Path(project_path).resolve())
    except ValueError:
        direct = Path()
    if direct.is_file() and direct.suffix.lower() in {".step", ".stp"}:
        return direct
    resolved = cad_service.resolve_project_file(project_path, supplied)
    if resolved is not None and resolved.suffix.lower() in {".step", ".stp"}:
        return resolved

    found = cad_service.find_step_source(project_path, stem)
    if found is not None:
        return found
    bare = stem.replace("__faceted", "") or stem
    for candidate in (
        project_path / raw,
        project_path / f"{stem}.step",
        project_path / f"{stem}.stp",
        project_path / f"{stem}__faceted.step",
        project_path / f"{bare}.step",
        project_path / f"{bare}.stp",
        project_path / f"{bare}__faceted.step",
    ):
        if candidate.is_file() and candidate.suffix.lower() in {".step", ".stp"}:
            return candidate
    return None


def _project_reference_step_inputs(project_path: Path, prompt: str) -> dict[str, str]:
    """Find verified project STEP references named by the current request."""
    words = {
        word
        for word in re.findall(r"[a-z0-9]+", str(prompt or "").lower())
        if len(word) >= 4
    }
    if not words:
        return {}
    root = Path(project_path) / "references"
    if not root.is_dir():
        return {}
    matches: dict[str, str] = {}
    try:
        candidates = sorted(
            path
            for path in root.rglob("*")
            if path.is_file() and path.suffix.lower() in {".step", ".stp"}
        )[:64]
    except OSError:
        return {}
    for path in candidates:
        name_words = set(re.findall(r"[a-z0-9]+", path.stem.lower()))
        if not any(word in words for word in name_words if len(word) >= 4):
            continue
        alias = "project_ref_" + _slug(path.stem.lower())
        matches[alias] = path.relative_to(project_path).as_posix()
    return matches


def _auto_input_objects(
    project_path: Path,
    context: dict[str, Any] | None,
    explicit: dict[str, Any] | None = None,
    *,
    prompt: str = "",
) -> dict[str, str]:
    """Map aliases → STEP filenames.

    Edit jobs get ``selected_object``. NEW jobs get ``reference_object`` for the
    attached/selected STEP to mate against, plus hw_* / named siblings.
    """
    mapping: dict[str, str] = {}
    ctx = context or {}

    def add(alias: str, name: str | None) -> None:
        key = str(alias or "").strip()
        path = _project_step_for_name(project_path, name)
        if not key or path is None or key in mapping:
            return
        try:
            mapping[key] = path.resolve().relative_to(Path(project_path).resolve()).as_posix()
        except ValueError:
            mapping[key] = path.name

    if isinstance(explicit, dict):
        for alias, filename in explicit.items():
            add(str(alias), str(filename))
    for alias, filename in _project_reference_step_inputs(project_path, prompt).items():
        add(alias, filename)
    is_edit = str(ctx.get("target_mode") or "").lower() == "edit"
    for ref in ctx.get("refs") or []:
        if not isinstance(ref, dict):
            continue
        name = ref.get("filename") or ref.get("viewer_filename") or ref.get("name")
        kind = str(ref.get("type") or "").lower()
        token = str(ref.get("token") or "").lower()
        selectedish = (
            kind in {"component", "selection", "cad"}
            or "select" in kind
            or token in {"@selected-object", "@selected"}
            or bool(ref.get("mate_target"))
        )
        if selectedish:
            if is_edit:
                add("selected_object", name)
            else:
                add("reference_object", name)
        add(Path(str(name or "part")).stem.replace(" ", "_")[:40] or "part", name)
    for comp in ctx.get("referenced_components") or []:
        if not isinstance(comp, dict):
            continue
        name = comp.get("filename") or comp.get("name") or comp.get("viewer_filename")
        if is_edit:
            add("selected_object", name)
        add(Path(str(name or "part")).stem.replace(" ", "_")[:40] or "part", name)
    for item in ctx.get("cad_files") or []:
        if not isinstance(item, dict):
            continue
        name = item.get("step") or item.get("filename") or item.get("name")
        if not is_edit:
            add("reference_object", name)
        add(Path(str(name or "cad")).stem.replace(" ", "_")[:40] or "cad", name)
    if is_edit:
        add("selected_object", ctx.get("base_filename"))
        add("base", ctx.get("base_filename"))
    try:
        from backend.services import cad_service as _cad

        for entry in (_cad.list_mcmaster_library(project_path) or [])[:12]:
            name = entry.get("project_filename") or entry.get("filename") or entry.get("name")
            pn = str(entry.get("part_number") or Path(str(name or "hw")).stem)
            alias = "hw_" + re.sub(r"[^A-Za-z0-9_]", "_", pn)[:28]
            add(alias, name)
    except Exception:
        pass
    return mapping


def _resolve_worker_inputs(
    project_path: Path,
    input_objects: dict[str, Any] | None,
) -> dict[str, str]:
    """Map aliases → absolute STEP paths for the isolated worker."""
    out: dict[str, str] = {}
    if not isinstance(input_objects, dict):
        return out
    for alias, filename in input_objects.items():
        key = str(alias or "").strip()
        raw_name = str(filename or "").strip()
        if not key or not raw_name:
            continue
        from backend.services.engine_layout import resolve_in_layout, sibling_with_suffix

        candidate = _project_step_for_name(project_path, raw_name)
        if candidate is None:
            candidate = resolve_in_layout(project_path, raw_name)
        if candidate is None or candidate.suffix.lower() not in {".step", ".stp"}:
            candidate = sibling_with_suffix(project_path, raw_name, (".step", ".stp"))
        if candidate is not None and candidate.is_file() and candidate.suffix.lower() in {".step", ".stp"}:
            out[key] = str(candidate.resolve())
    return out


def _missing_required_project_references(
    source: str, input_objects: dict[str, Any] | None
) -> list[str]:
    """Return verified project references that authored geometry ignored."""
    text = str(source or "")
    return [
        alias
        for alias in (input_objects or {})
        if str(alias).startswith("project_ref_")
        and not re.search(rf"inputs\s*(?:\[\s*['\"]{re.escape(str(alias))}['\"]\s*\]|\.get\(\s*['\"]{re.escape(str(alias))}['\"])", text)
    ]


def _strip_json(text: str) -> dict[str, Any]:
    raw = (text or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        raw = raw[start : end + 1]
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("model did not return a JSON object")
    return data


def _source_assigns_result(source: str) -> bool:
    return bool(re.search(r"(?m)^\s*result\s*=", str(source or "")))


def _worker_timeout_sec(
    expected_outputs: list[str] | None = None,
    *,
    timeout_sec: float | None = None,
    source: str | None = None,
) -> float:
    """Bound isolated compile time without changing authored geometry."""
    _ = source
    if timeout_sec is not None and float(timeout_sec) > 0:
        return float(timeout_sec)
    n = max(1, len(expected_outputs or []))
    return float(
        max(
            WORKER_TIMEOUT_MIN_SEC,
            min(WORKER_TIMEOUT_MAX_SEC, WORKER_TIMEOUT_PER_SOLID_SEC * n),
        )
    )


_GENERIC_OUTPUT_KEY_RE = re.compile(r"^(part|body|solid|compound|shape|object|result)_?\d*$", re.I)


def _publish_individual_part_meshes(
    output_count: int,
    keys: list[str] | None = None,
) -> bool:
    """Write per-part STEP/GLB only for uniquely named multi-body assemblies.

    One expected output, or generic ``Part_1`` / ``Part_2`` clones of one solid,
    must publish a single primary STEP/GLB — not N browser components.
    """
    count = int(output_count)
    if count <= 1 or count > _MAX_LIVE_PART_MESHES:
        return False
    labels = [str(key or "").strip() for key in (keys or []) if str(key or "").strip()]
    if labels and all(_GENERIC_OUTPUT_KEY_RE.fullmatch(label) for label in labels):
        return False
    return True


def _source_from_mapping(data: dict[str, Any] | None) -> str:
    if not isinstance(data, dict):
        return ""
    for key in _SOURCE_KEYS:
        val = data.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return ""


def _unwrap_tool_payload(data: dict[str, Any]) -> dict[str, Any]:
    """Accept oneshot JSON or Astra tool-call wrappers with source in args."""
    if not isinstance(data, dict):
        return {}
    args = data.get("args") or data.get("arguments")
    tool = str(data.get("tool") or data.get("name") or "")
    if isinstance(args, dict) and (
        _source_from_mapping(args)
        or args.get("expected_outputs")
        or args.get("model_name")
        or tool.endswith("create_model")
        or tool.endswith("edit_source")
    ):
        merged = dict(args)
        if data.get("model_name") and not merged.get("model_name"):
            merged["model_name"] = data["model_name"]
        return merged
    return data


def _python_source_from_text(text: str) -> str:
    for match in re.finditer(r"```(?:python|py)?\s*\n(.*?)```", str(text or ""), re.S | re.I):
        body = match.group(1).strip()
        if _source_assigns_result(body):
            return body
    return ""


def _is_passthrough_hardware_source(source: str) -> bool:
    """True when a NEW job only relabels a staged STEP instead of building the part."""
    text = str(source or "")
    if _CONSTRUCT_RE.search(text):
        return False
    if not _source_assigns_result(text):
        return False
    if not re.search(r"\binputs\s*[.\[]", text):
        return False
    return len(text) < 2000


def _coerce_authoring_program(text: str) -> dict[str, Any]:
    """Turn Codex/Astra replies (tool-call JSON, fences, notes) into oneshot authoring JSON."""
    raw = str(text or "")
    data: dict[str, Any] = {}
    try:
        parsed = _strip_json(raw)
        if isinstance(parsed, dict):
            data = parsed
    except Exception:
        data = {}
    payload = _unwrap_tool_payload(data) if data else {}
    validate_assembly_manifest(payload)
    source = _source_from_mapping(payload) or _python_source_from_text(raw)
    if not source or not _source_assigns_result(source):
        raise ValueError(
            "Authoring JSON missing build123d source that assigns `result`. "
            "Return top-level JSON with a `source` string containing `result = { ... }`. "
            "Do not wrap that as {\"tool\":\"build123d.create_model\",\"args\":{...}}."
        )
    parameters = payload.get("parameters") if isinstance(payload.get("parameters"), dict) else {}
    expected = payload.get("expected_outputs")
    if not isinstance(expected, list):
        expected = []
    input_objects = payload.get("input_objects") if isinstance(payload.get("input_objects"), dict) else {}
    return {
        "model_name": str(payload.get("model_name") or data.get("model_name") or ""),
        "source": source,
        "parameters": parameters,
        "expected_outputs": expected,
        "input_objects": input_objects,
        "joints": payload.get("joints") if isinstance(payload.get("joints"), list) else None,
        "parts_list": payload.get("parts_list"),
    }


def _worker_runtime() -> tuple[str, Path]:
    from backend.services.skill_runner import resolve_cad_python

    executable = resolve_cad_python()
    probe = subprocess.run(
        [executable, "-I", "-c", "import build123d; print(build123d.__file__)"],
        check=True, capture_output=True, text=True, timeout=30,
    )
    return executable, Path(probe.stdout.strip()).resolve().parents[1]


def _stage_project_drawings(project_path: Path, work: Path) -> list[str]:
    """Copy project DXF/SVG into the isolated worker cwd so import_dxf() works like Jake."""
    return stage_project_drawings(project_path, work)


def _worker_path() -> Path:
    return Path(__file__).resolve().parents[1] / "skills" / "vibecad" / "scripts" / "build123d_worker.py"


def _run_worker(
    *,
    project_path: Path,
    stem: str,
    source: str,
    parameters: dict[str, Any],
    expected_outputs: list[str],
    inputs: dict[str, str] | None = None,
    cancel_check: CancelCb = None,
    timeout_sec: float | None = None,
) -> dict[str, Any]:
    worker = _worker_path()
    if not worker.is_file():
        raise RuntimeError(f"VibeCAD worker missing: {worker}")
    executable, site_packages = _worker_runtime()
    work = project_path / ".vibecad_work" / stem
    if work.exists():
        shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True, exist_ok=True)
    _stage_project_drawings(project_path, work)
    out_dir = work / "outputs"
    out_dir.mkdir(parents=True, exist_ok=True)
    req_path = work / "request.json"
    res_path = work / "result.json"
    # Copy linked STEP inputs into the work dir so the -I -S worker can read them.
    worker_inputs: dict[str, str] = {}
    inputs_dir = work / "inputs"
    if inputs:
        inputs_dir.mkdir(parents=True, exist_ok=True)
        for alias, abs_path in inputs.items():
            src = Path(abs_path)
            if not src.is_file():
                continue
            dest = inputs_dir / f"{_slug(alias)}_{src.name}"
            shutil.copy2(src, dest)
            worker_inputs[str(alias)] = str(dest)
    req_path.write_text(
        json.dumps(
            {
                "build123d_version": "0.11.1",
                "ocp_version": "7.9.3.1.1",
                "source": source,
                "parameters": parameters or {},
                "inputs": worker_inputs,
                "expected_outputs": expected_outputs,
                "output_directory": str(out_dir),
                "memory_limit_bytes": 0,
                "cpu_limit_seconds": 0,
                "output_limit_bytes": 0,
            },
            ensure_ascii=True,
        ),
        encoding="utf-8",
    )
    cmd = [
        executable,
        "-I",
        "-S",
        str(worker),
        str(req_path),
        str(res_path),
        str(site_packages),
    ]
    started = time.monotonic()
    limit = _worker_timeout_sec(expected_outputs, timeout_sec=timeout_sec, source=source)
    stdout_path = work / "worker.stdout"
    stderr_path = work / "worker.stderr"
    stdout = ""
    stderr = ""
    timed_out = False
    with stdout_path.open("w", encoding="utf-8", errors="replace") as out_f, stderr_path.open(
        "w", encoding="utf-8", errors="replace"
    ) as err_f:
        proc = subprocess.Popen(
            cmd,
            cwd=str(work),
            stdout=out_f,
            stderr=err_f,
            text=True,
        )
        try:
            while True:
                if cancel_check and cancel_check():
                    proc.kill()
                    raise RuntimeError("Generation canceled.")
                if proc.poll() is not None:
                    break
                if time.monotonic() - started > limit:
                    proc.kill()
                    timed_out = True
                    break
                time.sleep(0.15)
            try:
                proc.wait(timeout=5)
            except Exception:
                proc.kill()
        except RuntimeError:
            raise
        except Exception:
            proc.kill()
            raise
    try:
        stdout = stdout_path.read_text(encoding="utf-8", errors="replace")
        stderr = stderr_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        pass

    payload: dict[str, Any] = {}
    if res_path.is_file():
        try:
            payload = json.loads(res_path.read_text(encoding="utf-8"))
        except Exception as exc:
            payload = {"ok": False, "error": f"could not parse worker result: {exc}"}
    if not payload:
        payload = {
            "ok": False,
            "error": f"worker exited {proc.returncode}",
            "stdout": (stdout or "")[-2000:],
            "stderr": (stderr or "")[-2000:],
        }
    # A timeout/export failure may leave a few STEP files. They are partial
    # artifacts, not a successful model; let the normal repair path handle it.
    if timed_out and not (payload.get("ok") and payload.get("outputs")):
        raise RuntimeError(f"VibeCAD build123d worker timed out after {int(limit)}s")
    payload["_work_dir"] = str(work)
    return payload


def _publish_outputs(
    project_path: Path,
    stem: str,
    worker_result: dict[str, Any],
    progress_callback: ProgressCb = None,
    *,
    previous_source_name: str | None = None,
    base_filename: str | None = None,
) -> dict[str, Any]:
    from backend.services.vibecad_publish_worker import publish_with_pinned_runtime
    from backend.services.engine_layout import artifacts_for, project_rel

    outputs = worker_result.get("outputs") or []
    if not outputs:
        raise RuntimeError("VibeCAD worker produced no STEP outputs")
    if worker_result.get("ok") is not True:
        raise RuntimeError("VibeCAD worker failed; partial outputs cannot be published")
    for item in outputs:
        if not Path(str(item.get("step_path") or "")).is_file():
            raise RuntimeError(f"VibeCAD assembly is missing output {item.get('key')!r}")
    assembly_only = len(outputs) == 1 and str(outputs[0].get("key") or "").lower() == "assembly"
    keys = [str(item.get("key") or "") for item in outputs]
    split_parts = not assembly_only and _publish_individual_part_meshes(len(outputs), keys=keys)
    arts = artifacts_for(
        project_path, "vibecad", stem,
        previous_source_name=previous_source_name, base_filename=base_filename,
    )
    arts.directory.mkdir(parents=True, exist_ok=True)
    parts = []
    if split_parts:
        for index, key in enumerate(keys, 1):
            base = arts.directory / f"{stem}__part_{index:02d}_{_slug(key)}"
            parts.append({"step": str(base.with_suffix(".step").resolve()), "glb": str(base.with_suffix(".glb").resolve())})
    request = {
        "outputs": outputs, "assembly_only": assembly_only,
        "primary_step": str(arts.step_path.resolve()),
        "primary_glb": str(arts.glb_path.resolve()), "parts": parts,
    }
    receipt = publish_with_pinned_runtime(request)
    from backend.services.cad_preview_optimizer import maybe_optimize_cad_preview

    try:
        preview_optimization = maybe_optimize_cad_preview(arts.glb_path)
        if preview_optimization.applied:
            receipt["preview_occurrence_count"] = preview_optimization.after.objects
        receipt["preview_optimization"] = preview_optimization.to_dict()
    except Exception as exc:
        logger.warning("Keeping original VibeCAD preview after optimization rejection: %s", exc)
        receipt["preview_optimization"] = {"applied": False, "reason": f"rejected: {exc}"}
    return {
        "source": arts.source_name,
        "step": project_rel(project_path, arts.step_path),
        "glb": project_rel(project_path, arts.glb_path),
        "parts_step": [project_rel(project_path, Path(part["step"])) for part in parts],
        "parts_glb": [project_rel(project_path, Path(part["glb"])) for part in parts],
        "worker_result": worker_result,
        **receipt,
    }


def _vibecad_codex_hard_fail(message: str) -> bool:
    blob = str(message or "").lower()
    needles = (
        "not supported when using Codex with a ChatGPT account",
        "requires a newer version of Codex",
        "Codex CLI not found",
        "Sign in with ChatGPT",
        "Codex exec failed",
        "Codex returned an empty response",
        "Codex CLI returned an error",
        "not available on ChatGPT Codex",
        "401 unauthorized",
        "missing bearer",
    )
    return any(n.lower() in blob for n in needles)


def run_vibecad(
    prompt: str,
    project_path: Path,
    context: dict[str, Any] | None,
    ai: AIService,
    *,
    trace_id: str | None = None,
    images: list[dict[str, Any]] | None = None,
    previous_source: str | None = None,
    previous_source_name: str | None = None,
    cancel_check: CancelCb = None,
    progress_callback: ProgressCb = None,
    usage_callback: UsageCb = None,
    max_repairs: int = 8,
    skills: list[str] | None = None,
) -> dict[str, Any]:
    """Author CAD. Codex is the host for every model; the sidecar publishes STEP/GLB.

    One-shot JSON authoring is only used when ``context["vibecad_oneshot"]`` is
    true. The in-process tool agent is only ``vibecad_agent``. Agent failures
    are not silently rewritten into the one-shot path.
    """
    try:
        from backend.services.skills_service import get_skill_dir

        get_skill_dir("vibecad")
    except Exception:
        pass
    ctx = context or {}
    from backend.services.vibecad_codex import choose_vibecad_runtime, run_vibecad_codex_host

    runtime = choose_vibecad_runtime(ctx, ai)
    if runtime == "codex_host":
        return run_vibecad_codex_host(
            prompt,
            project_path,
            ctx,
            ai,
            trace_id=trace_id,
            images=images,
            previous_source=previous_source,
            previous_source_name=previous_source_name,
            cancel_check=cancel_check,
            progress_callback=progress_callback,
            usage_callback=usage_callback,
            max_repairs=max_repairs,
            skills=skills,
        )
    use_agent = runtime == "agent"
    if use_agent:
        try:
            return _run_vibecad_agent(
                prompt,
                project_path,
                ctx,
                ai,
                trace_id=trace_id,
                images=images,
                previous_source=previous_source,
                previous_source_name=previous_source_name,
                cancel_check=cancel_check,
                progress_callback=progress_callback,
                usage_callback=usage_callback,
                max_repairs=max_repairs,
                skills=skills,
            )
        except Exception as exc:
            if "canceled" in str(exc).lower() or "cancelled" in str(exc).lower():
                raise
            raise RuntimeError(f"VibeCAD agent failed: {exc}") from exc
    return _run_vibecad_legacy_oneshot(
        prompt,
        project_path,
        context,
        ai,
        trace_id=trace_id,
        images=images,
        previous_source=previous_source,
        previous_source_name=previous_source_name,
        cancel_check=cancel_check,
        progress_callback=progress_callback,
        usage_callback=usage_callback,
        max_repairs=max_repairs,
        skills=skills,
    )


def _run_vibecad_agent(
    prompt: str,
    project_path: Path,
    context: dict[str, Any] | None,
    ai: AIService,
    *,
    trace_id: str | None = None,
    images: list[dict[str, Any]] | None = None,
    previous_source: str | None = None,
    previous_source_name: str | None = None,
    cancel_check: CancelCb = None,
    progress_callback: ProgressCb = None,
    usage_callback: UsageCb = None,
    max_repairs: int = 8,
    skills: list[str] | None = None,
) -> dict[str, Any]:
    """Tool-calling agent path (inspect → review → create). Default for VibeCAD."""
    project_path = Path(project_path)
    project_path.mkdir(parents=True, exist_ok=True)

    from backend.services.freecad_engine import freecad_available, freecad_status
    from backend.services.vibecad_agent import VibeCADAgent

    status = freecad_status()
    trace_add(
        "info",
        f"[VibeCAD] agent pipeline · freecad={status.get('available')} cmd={status.get('cmd')}",
        trace_id=trace_id,
        data=status,
    )
    _progress(
        progress_callback,
        "analyze",
        6,
        "VibeCAD · FreeCAD engine…" if status.get("available") else "VibeCAD · build123d sidecar…",
    )

    ctx = context or {}
    try:
        session_turns = ctx.get("max_turns")
        if session_turns is None:
            agent_turns = 200
        else:
            agent_turns = max(1, int(session_turns))
            if agent_turns <= 0:
                agent_turns = 200
    except (TypeError, ValueError):
        agent_turns = 200

    agent = VibeCADAgent(
        project_path=project_path,
        prompt=prompt,
        context=ctx,
        ai=ai,
        trace_id=trace_id,
        images=images,
        previous_source=previous_source,
        previous_source_name=previous_source_name,
        cancel_check=cancel_check,
        progress_callback=progress_callback,
        usage_callback=usage_callback,
        max_turns=agent_turns,
        prefer_freecad=bool(status.get("available")),
        skills=skills,
    )
    outcome = agent.run()
    published = outcome["published"]
    display_name = str(outcome.get("model_name") or "VibeCAD Model")
    engine = str(outcome.get("engine") or "build123d")
    is_edit = bool(previous_source) or bool((context or {}).get("target_mode") == "edit")
    stem = Path(published["glb"]).stem

    from backend.services.project_store import apply_prompt_project_name

    apply_prompt_project_name(project_path, prompt, fallback=display_name)
    try:
        from backend.services.cad_harness import finalize_harness_run

        finalize_harness_run(
            project_path,
            published_step=published.get("step"),
            is_edit=is_edit,
        )
    except Exception:
        pass
    _progress(progress_callback, "done", 100, f"VibeCAD ({engine}) model ready")

    files: dict[str, Any] = {
        "source": published["source"],
        "step": published["step"],
        "glb": published["glb"],
        "vibecad_meta": f"{stem}.vibecad.json",
    }
    if published.get("parts_glb"):
        files["parts"] = published["parts_glb"]

    return {
        "intent": "generative",
        "message": (
            f"{'Updated' if is_edit else 'Built'} {display_name} with the VibeCAD "
            f"{'FreeCAD' if engine == 'freecad' else 'build123d'} engine."
        ),
        "specs_used": [{"source": "vibecad", "script": published["source"], "engine": engine}],
        "result": {
            "program": {
                "name": display_name,
                "source": "vibecad",
                "source_file": published["source"],
                "entrypoint": "result",
                "engine": engine,
            },
            "primary": published["glb"],
            "basename": stem,
            "files": files,
            "parts": [
                {"name": Path(name).stem, "filename": name}
                for name in (published.get("parts_glb") or [])
            ],
            "text_to_cad": {
                "runtime": f"vibecad_{engine}",
                "runtime_provenance": (published.get("worker_result") or {}).get("runtime_provenance", {}),
                "publication_runtime_provenance": published.get("publication_runtime_provenance", {}),
                "visual_gate": agent.state.get("visual_gate"),
                "authoring_agent": True,
                "freecad": freecad_available(),
                "worker": (
                    "vendor/freecad/FreeCAD.app (FreeCADCmd)"
                    if engine == "freecad"
                    else "skills/vibecad/scripts/build123d_worker.py"
                ),
            },
        },
        "attempts": int(outcome.get("attempts") or 1),
        "ai_trace": outcome.get("ai_traces") or [],
        "dfm_warnings": [],
        "primary": published["glb"],
        "filename": published["glb"],
    }


def _run_vibecad_legacy_oneshot(
    prompt: str,
    project_path: Path,
    context: dict[str, Any] | None,
    ai: AIService,
    **kwargs: Any,
) -> dict[str, Any]:
    from backend.services.engine_layout import artifacts_for
    from backend.services.project_store import title_from_prompt
    from backend.services.vibecad_artifact_transaction import preserve_accepted_artifacts

    previous_source_name = kwargs.get("previous_source_name")
    stem = Path(previous_source_name).stem if previous_source_name else _slug(title_from_prompt(prompt) or "VibeCAD Model", "vibecad_model")
    if stem.endswith(".vibecad"):
        stem = stem[:-len(".vibecad")] or "vibecad_model"
    arts = artifacts_for(
        project_path, "vibecad", stem,
        previous_source_name=previous_source_name,
        base_filename=str((context or {}).get("base_filename") or "") or None,
    )
    with preserve_accepted_artifacts(project_path, arts.directory, stem):
        return _run_vibecad_legacy_oneshot_unchecked(prompt, project_path, context, ai, **kwargs)


def _run_vibecad_legacy_oneshot_unchecked(
    prompt: str,
    project_path: Path,
    context: dict[str, Any] | None,
    ai: AIService,
    *,
    trace_id: str | None = None,
    images: list[dict[str, Any]] | None = None,
    previous_source: str | None = None,
    previous_source_name: str | None = None,
    cancel_check: CancelCb = None,
    progress_callback: ProgressCb = None,
    usage_callback: UsageCb = None,
    max_repairs: int = 8,
    skills: list[str] | None = None,
) -> dict[str, Any]:
    """Original one-shot LLM→build123d worker loop (fallback)."""
    project_path = Path(project_path)
    project_path.mkdir(parents=True, exist_ok=True)
    ctx = context or {}
    is_edit = bool(previous_source) or bool(ctx.get("target_mode") == "edit")
    base = Path(previous_source_name).stem if previous_source_name else ""
    if not base:
        from backend.services.project_store import title_from_prompt

        title = title_from_prompt(prompt) or "VibeCAD Model"
        base = _slug(title, "vibecad_model")
    # Avoid clobbering Jake `.py` generators — VibeCAD sources use `.vibecad.py`.
    if base.endswith(".vibecad"):
        stem = base[: -len(".vibecad")] or "vibecad_model"
    else:
        stem = base
    source_name = f"{stem}.vibecad.py"
    source_path = project_path / source_name

    ai_traces: list[dict[str, Any]] = []

    def _sync_usage() -> None:
        if usage_callback and ai_traces:
            usage_callback(list(ai_traces))

    def _on_codex_trace(trace: dict[str, Any]) -> None:
        if not isinstance(trace, dict):
            return
        last = ai_traces[-1] if ai_traces else None
        if (
            isinstance(last, dict)
            and last.get("stage") == "codex_llm"
            and last.get("elapsed_ms") is None
        ):
            ai_traces[-1] = trace
        else:
            ai_traces.append(trace)
        _sync_usage()

    if hasattr(ai, "set_usage_callback"):
        try:
            ai.set_usage_callback(_on_codex_trace)
        except Exception:
            pass

    def _canceled() -> bool:
        return bool(cancel_check and cancel_check())

    budget = max(1, int(max_repairs))
    last_error = ""
    program: dict[str, Any] | None = None
    published: dict[str, Any] | None = None
    attempts = 0

    from backend.services.cli_subscription_ai import ai_uses_cli_host, cli_host_label

    vibe_codex = ai_uses_cli_host(ai)
    vibe_model = cli_host_label(ai) if vibe_codex else ""

    _progress(progress_callback, "analyze", 8, "VibeCAD · analyzing prompt & links…")
    edit_line = (
        f"EDIT the existing VibeCAD model `{source_name}` — revise in place.\n"
        if is_edit
        else "NEW model — create a fresh parametric build123d program.\n"
    )
    context_packet = _context_brief(ctx, project_path, prompt=prompt)
    user_brief = (
        f"{edit_line}"
        f"User request:\n{prompt.strip()}\n"
    )
    if context_packet:
        user_brief += f"\n{context_packet}\n"
    auto_inputs = _auto_input_objects(project_path, ctx, {}, prompt=prompt)
    if auto_inputs:
        user_brief += (
            "\nStaged STEP inputs (map these aliases in input_objects; values are already "
            "Shapes in `inputs` — do not import_step() them):\n"
            + "\n".join(f"- {k}: {v}" for k, v in auto_inputs.items())
            + "\n"
        )
        project_refs = [key for key in auto_inputs if key.startswith("project_ref_")]
        if project_refs:
            user_brief += (
                "Verified project references are mandatory source geometry. Use "
                + ", ".join(f"inputs['{key}']" for key in project_refs)
                + " in the assembled result; do not redraw those products from primitives.\n"
            )
        if is_edit and auto_inputs.get("selected_object"):
            user_brief += (
                "EDIT: revise inputs['selected_object'] in place; keep that Shape in `result`.\n"
            )
        elif auto_inputs.get("reference_object"):
            user_brief += (
                "NEW model: inputs['reference_object'] is the attached/selected STEP to model TO. "
                "Mate the requested printed solids to that B-rep (faces, T-slots, profiles). "
                "Keep the reference solid unchanged — do not rebuild it, and do not return a "
                "program that only relabels inputs['reference_object'] or hw_*.\n"
            )
        else:
            user_brief += (
                "NEW model: hardware/sibling STEPs are to mate, not the whole design. "
                "Build the requested named solids. Do not return a program that only "
                "relabels inputs['selected_object'] or hw_*.\n"
            )
    if previous_source and previous_source.strip():
        user_brief += (
            "\nExisting source to revise:\n"
            f"```python\n{previous_source[:14000]}\n```\n"
        )

    for attempt in range(budget):
        if _canceled():
            raise RuntimeError("Generation canceled.")

        attempts = attempt + 1
        if vibe_codex:
            author_label = f"VibeCAD · {vibe_model} (try {attempts}/{budget})…"
        else:
            author_label = f"VibeCAD · authoring build123d (try {attempts}/{budget})…"
        _progress(
            progress_callback,
            "generate",
            min(55, 12 + attempt * 7),
            author_label,
        )

        repair = ""
        if last_error:
            repair = f"\n\nPrevious worker/authoring failure — fix and return full JSON:\n{last_error[:4000]}\n"
            system = _with_vibecad_skills(VIBECAD_REPAIR_SYSTEM, skills)
        else:
            system = _with_vibecad_skills(VIBECAD_SYSTEM, skills)

        try:
            text, trace = ai._call_model(
                system,
                user_brief + repair,
                trace_id=trace_id,
                images=images,
                max_tokens=cad_authoring_max_tokens(ai.model),
                json_response=True,
                allow_truncated=False,
            )
            if isinstance(trace, dict):
                last = ai_traces[-1] if ai_traces else None
                if (
                    isinstance(last, dict)
                    and last.get("stage") == "codex_llm"
                    and last.get("elapsed_ms") is None
                ):
                    ai_traces[-1] = trace
                else:
                    ai_traces.append(trace)
                _sync_usage()
            program = _coerce_authoring_program(text)
            from backend.services.assembly_motion import motion_authoring_error
            motion_rows = program.get('joints')
            if motion_rows is None and is_edit:
                from backend.services.cad_harness import load_harness_joints
                motion_rows = load_harness_joints(project_path, stem=str(Path(str(ctx.get('base_filename') or stem)).with_suffix('')))
            error = motion_authoring_error(prompt, motion_rows)
            if error: raise ValueError(error)
        except Exception as exc:
            last_error = str(exc)
            trace_add("error", f"[VibeCAD] authoring failed: {exc}", trace_id=trace_id)
            if vibe_codex and _vibecad_codex_hard_fail(last_error):
                raise RuntimeError(last_error) from exc
            continue

        source = str(program.get("source") or "").strip()
        parameters = program.get("parameters") if isinstance(program.get("parameters"), dict) else {}
        expected = [str(x) for x in (program.get("expected_outputs") or []) if str(x).strip()]
        input_objects = program.get("input_objects") if isinstance(program.get("input_objects"), dict) else {}
        input_objects = _auto_input_objects(project_path, ctx, input_objects, prompt=prompt)
        model_name = str(program.get("model_name") or stem)
        lint = _lint_vibecad_source(source)
        if lint:
            last_error = lint
            continue
        missing_project_refs = _missing_required_project_references(source, input_objects)
        if missing_project_refs:
            last_error = (
                "Verified project STEP reference(s) were staged but ignored: "
                + ", ".join(missing_project_refs)
                + ". Use their inputs aliases in the assembled result instead of "
                "creating a primitive stand-in."
            )
            continue
        if not is_edit and _is_passthrough_hardware_source(source):
            last_error = (
                "NEW model must author the requested part, not wrap a staged hardware STEP. "
                "Mate inputs[hw_*] / sibling STEPs; put chassis/deck/adapter solids in `result`."
            )
            continue
        if is_edit and input_objects.get("selected_object") and "inputs[" not in source and "inputs.get" not in source:
            last_error = (
                "Selected STEP is staged as inputs['selected_object'] "
                f"({input_objects.get('selected_object')}). Use that Shape and edit it — "
                "do not rebuild a primitive stand-in."
            )
            continue
        if not expected:
            # Infer keys from a simple result = {...} literal when possible.
            expected = ["Part"]
            program["expected_outputs"] = expected

        worker_inputs = _resolve_worker_inputs(project_path, input_objects)
        source_path.write_text(source.rstrip() + "\n", encoding="utf-8")
        meta_path = project_path / f"{stem}.vibecad.json"
        meta_path.write_text(
            json.dumps(
                {
                    "model_name": model_name,
                    "parameters": parameters,
                    "expected_outputs": expected,
                    "input_objects": input_objects,
                    "runtime": "vibecad-build123d",
                    "source": source_name,
                    "joints": program.get("joints") if isinstance(program.get("joints"), list) else [],
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )

        _progress(progress_callback, "step", min(78, 50 + attempt * 4), "VibeCAD · running build123d worker…")
        try:
            worker_result = _run_worker(
                project_path=project_path,
                stem=stem,
                source=source,
                parameters=parameters,
                expected_outputs=expected,
                inputs=worker_inputs,
                cancel_check=cancel_check,
                timeout_sec=_worker_timeout_sec(expected, source=source),
            )
        except RuntimeError as exc:
            if "canceled" in str(exc).lower():
                raise
            last_error = str(exc)
            continue

        worker_result = worker_result or {}
        if not worker_result.get("ok"):
            last_error = (
                str(worker_result.get("error") or "build123d worker failed")
                + "\n"
                + str(worker_result.get("traceback") or "")[:2500]
            )
            trace_add(
                "warning",
                f"[VibeCAD] worker failed (try {attempts}): {last_error[:400]}",
                trace_id=trace_id,
            )
            continue

        _progress(progress_callback, "export", 88, "VibeCAD · publishing STEP/GLB to viewport…")
        try:
            published = _publish_outputs(
                project_path,
                stem,
                worker_result,
                progress_callback,
                previous_source_name=previous_source_name,
                base_filename=str(ctx.get("base_filename") or "") or None,
            )
        except Exception as exc:
            last_error = f"publish failed: {exc}"
            trace_add("warning", f"[VibeCAD] publish failed: {exc}", trace_id=trace_id)
            published = None
            continue
        from backend.services.vibecad_gates import run_post_publish_visual_gate

        visual_gate = run_post_publish_visual_gate(
            ai=ai,
            project_path=project_path,
            prompt=prompt,
            source=source,
            published=published,
            worker_result=worker_result,
            progress_callback=progress_callback,
            trace_id=trace_id,
            cancel_check=cancel_check,
        )
        if isinstance(visual_gate.get("ai_trace"), dict):
            _on_codex_trace(visual_gate["ai_trace"])
        if visual_gate.get("ok") is not True:
            last_error = str(visual_gate.get("repair_note") or visual_gate.get("error") or "Visual review failed")
            published = None
            continue
        break

    if not published or not (project_path / published["glb"]).is_file():
        raise RuntimeError(last_error or "VibeCAD generation failed")

    from backend.services.project_store import apply_prompt_project_name, title_from_prompt

    display_name = str((program or {}).get("model_name") or title_from_prompt(prompt) or stem)
    apply_prompt_project_name(project_path, prompt, fallback=display_name)
    try:
        from backend.services.cad_harness import finalize_harness_run

        finalize_harness_run(
            project_path,
            published_step=published.get("step"),
            is_edit=is_edit,
            joints=(program or {}).get("joints"),
            parts_list=(program or {}).get("parts_list"),
        )
    except Exception:
        pass

    _progress(progress_callback, "done", 100, "VibeCAD model ready")
    files: dict[str, Any] = {
        "source": published["source"],
        "step": published["step"],
        "glb": published["glb"],
        "vibecad_meta": f"{stem}.vibecad.json",
    }
    if published.get("parts_glb"):
        files["parts"] = published["parts_glb"]

    return {
        "intent": "generative",
        "message": f"{'Updated' if is_edit else 'Built'} {display_name} with the VibeCAD build123d engine.",
        "specs_used": [{"source": "vibecad", "script": published["source"]}],
        "result": {
            "program": {
                "name": display_name,
                "source": "vibecad",
                "source_file": published["source"],
                "entrypoint": "result",
            },
            "primary": published["glb"],
            "basename": stem,
            "files": files,
            "parts": [
                {"name": Path(name).stem, "filename": name}
                for name in (published.get("parts_glb") or [])
            ],
            "text_to_cad": {
                "runtime": "vibecad_build123d",
                "authoring_agent": True,
                "worker": "skills/vibecad/scripts/build123d_worker.py",
                "runtime_provenance": worker_result.get("runtime_provenance", {}),
                "publication_runtime_provenance": published.get("publication_runtime_provenance", {}),
                "visual_gate": visual_gate,
            },
        },
        "attempts": max(1, attempts),
        "ai_trace": ai_traces,
        "dfm_warnings": [],
        "primary": published["glb"],
        "filename": published["glb"],
    }
