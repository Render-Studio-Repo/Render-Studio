"""Assess CAD assemblies with moving parts and author URDF/SRDF when feasible.

Jake kernel builds already emit URDF from program.json joints. VibeCAD gears
often only have named solids + a drive parameter. This module decides whether
a model can be described as a mechanism and writes URDF/SRDF (plus optional
GLB body labels) so the viewport can animate sun/planet/carrier turning.
"""

from __future__ import annotations

import json
import logging
import os
import re
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

from backend.services.engine_layout import ENGINE_FOLDER_SET, model_stem, project_rel, safe_project_path

logger = logging.getLogger("render3d")

MOVABLE_JOINT_TYPES = frozenset({"revolute", "continuous", "prismatic"})
ROBOT_ARTIFACT_SUFFIXES = {".urdf", ".srdf", ".sdf", ".mjcf"}

GEAR_HINT_RE = re.compile(
    r"(planetary|plantry|gear(?:box|ing|train)?|pinion|sprocket|rack(?:\s*and\s*pinion)?"
    r"|sun[_\s-]?gear|ring[_\s-]?gear|planet[_\s-]?gear|carrier|epicyclic)",
    re.I,
)
ROBOT_HINT_RE = re.compile(
    r"\b(urdf|srdf|robot(?:ic)?|cobot|humanoid|manipulator|end[-\s]?effector|gripper|"
    r"scara|delta(?:\s+robot)?|gantry(?:\s+robot)?|industrial\s+arm|"
    r"6[-\s]?axis|5[-\s]?axis|4[-\s]?axis|[1-8]\s*-?\s*dof|degrees?\s+of\s+freedom|"
    r"articulated|kinematic|joint(?:ed|s)?|servo|actuator|linkage|"
    r"pick[-\s]?and[-\s]?place|legged|walker|hexapod|quadruped)\b",
    re.I,
)
MANUFACTURING_ONLY_RE = re.compile(
    r"\b(robot[-\s]?assembl(?:able|y)|assembled\s+by\s+(?:a\s+)?(?:fanuc\s+)?robot|"
    r"for\s+robotic\s+assembly|fanuc)\b",
    re.I,
)
REAL_ROBOT_RE = re.compile(
    r"\b(urdf|srdf|\bdof\b|end[-\s]?effector|manipulator|base_link|joint\s+limits|"
    r"kinematic\s+chain|moveit)\b",
    re.I,
)
SUN_NAME_RE = re.compile(r"(?:^|_)(?:s(?:tage)?_?\d+_)?(?:input_)?sun(?:_gear)?(?:$|_)", re.I)
RING_NAME_RE = re.compile(r"(?:ring(?:_gear)?|annulus|internal_gear)", re.I)
CARRIER_NAME_RE = re.compile(r"carrier", re.I)
PLANET_NAME_RE = re.compile(r"planet(?!.*(?:pin|bush|thrust|bolt))", re.I)
PIN_NAME_RE = re.compile(r"(?:^|_)pin(?:_|$)|planet_pin", re.I)
FIXED_NAME_RE = re.compile(
    r"(housing|cover|case|frame|base|spacer|retainer|clamp|jaw|bush|bearing|"
    r"hardware|hw_|bolt|screw|washer|insert)",
    re.I,
)
STAGE_RE = re.compile(r"(?:stage|s)_?(\d+)", re.I)
PLANET_INDEX_RE = re.compile(r"(?:planet[_-]?|_)(\d+)\s*$", re.I)
STAGE_ROW_RE = re.compile(
    r"\(\s*([12])\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*CENTER",
    re.I,
)
SUN_GEAR_CALL_RE = re.compile(r"sun\d*\s*=\s*gear\(\s*(\d+)", re.I)
RATIO_LINE_RE = re.compile(
    r"C1\s*,\s*C2\s*=\s*A\s*/\s*([0-9.]+)\s*,\s*A\s*/\s*([0-9.]+)",
)


def _norm(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(name or "").strip().lower()).strip("_")


def _robot_xml_name(stem: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9_]+", "_", str(stem or "").strip()) or "mechanism"
    slug = slug.strip("_") or "mechanism"
    if slug[0].isdigit():
        slug = f"m_{slug}"
    return slug[:80]


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _iter_engine_files(project_path: Path, suffixes: set[str] | None = None) -> list[Path]:
    root = Path(project_path)
    folders = [root, *[root / folder for folder in ENGINE_FOLDER_SET]]
    found: list[Path] = []
    for folder in folders:
        if not folder.is_dir():
            continue
        try:
            children = list(folder.iterdir())
        except OSError:
            continue
        for path in children:
            if not path.is_file():
                continue
            if suffixes is not None and path.suffix.lower() not in suffixes:
                if not any(str(path.name).lower().endswith(s) for s in suffixes):
                    continue
            found.append(path)
    return found


def python_sources(project_path: Path) -> list[str]:
    names: list[str] = []
    for path in _iter_engine_files(project_path, {".py"}):
        if path.name.lower().endswith(".rejected.py"):
            continue
        names.append(project_rel(Path(project_path), path))
    return sorted(set(names))


def robot_artifact_names(project_path: Path) -> list[str]:
    names: list[str] = []
    for path in _iter_engine_files(project_path):
        lower = path.name.lower()
        if path.suffix.lower() in {".urdf", ".srdf", ".sdf"} or lower.endswith(".mjcf.xml"):
            names.append(project_rel(Path(project_path), path))
    return sorted(set(names))


def _candidates_for_stem(project_path: Path, filename: str | None) -> list[Path]:
    root = Path(project_path)
    raw = str(filename or "").replace("\\", "/").strip()
    stem = model_stem(raw) if raw else ""
    out: list[Path] = []
    seen: set[str] = set()

    def add(path: Path) -> None:
        try:
            key = str(path.resolve())
        except OSError:
            key = str(path)
        if key in seen:
            return
        seen.add(key)
        out.append(path)

    if raw:
        try:
            add(safe_project_path(root, raw))
        except ValueError:
            direct = root / Path(raw).name
            if direct.is_file():
                add(direct)
    if not stem:
        return out
    suffixes = (
        ".glb",
        ".step",
        ".stp",
        ".program.json",
        ".sim.json",
        ".vibecad.json",
        ".vibecad.py",
        ".py",
        ".urdf",
        ".srdf",
    )
    folders = [root, *[root / folder for folder in ENGINE_FOLDER_SET]]
    for folder in folders:
        for suffix in suffixes:
            candidate = folder / f"{stem}{suffix}"
            if candidate.is_file():
                add(candidate)
    return out


def expected_part_names_near(path: Path) -> list[str]:
    """Named solids from a sibling VibeCAD/program sidecar next to a GLB/STEP."""
    dest = Path(path)
    stem = model_stem(dest.name)
    search = [dest.parent]
    if dest.parent.name in ENGINE_FOLDER_SET:
        search.append(dest.parent.parent)
    for folder in search:
        for suffix in (".vibecad.json", ".program.json"):
            sidecar = folder / f"{stem}{suffix}"
            data = _read_json(sidecar)
            if not data:
                continue
            if suffix == ".vibecad.json":
                names = [str(x).strip() for x in (data.get("expected_outputs") or []) if str(x).strip()]
                if names:
                    return names
            parts = data.get("parts") or []
            names = []
            for part in parts:
                if isinstance(part, dict):
                    pid = str(part.get("id") or part.get("name") or "").strip()
                    if pid:
                        names.append(pid)
                elif part:
                    names.append(str(part))
            if names:
                return names
    return []


def expected_part_names_for_file(project_path: Path, filename: str | None) -> list[str]:
    for path in _candidates_for_stem(project_path, filename):
        names = expected_part_names_near(path)
        if names:
            return names
        if path.suffix.lower() == ".json":
            data = _read_json(path)
            if not data:
                continue
            if path.name.lower().endswith(".vibecad.json"):
                names = [str(x).strip() for x in (data.get("expected_outputs") or []) if str(x).strip()]
                if names:
                    return names
            parts = data.get("parts") or []
            names = []
            for part in parts:
                if isinstance(part, dict):
                    pid = str(part.get("id") or part.get("name") or "").strip()
                    if pid:
                        names.append(pid)
            if names:
                return names
    return []


def _program_for_file(project_path: Path, filename: str | None) -> tuple[Path | None, dict[str, Any] | None]:
    for path in _candidates_for_stem(project_path, filename):
        if path.name.lower().endswith(".program.json"):
            data = _read_json(path)
            if data:
                return path, data
        if path.name.lower().endswith(".sim.json"):
            data = _read_json(path)
            if data and (data.get("joints") or data.get("parts")):
                return path, data
    # Same-folder program whose parts look geared, even if the stem differs.
    stem = model_stem(filename or "")
    if GEAR_HINT_RE.search(stem or ""):
        root = Path(project_path)
        for folder in [root, *[root / folder for folder in ENGINE_FOLDER_SET]]:
            if not folder.is_dir():
                continue
            for path in sorted(folder.glob("*.program.json")):
                data = _read_json(path)
                if data and _part_names_from_program(data) and _looks_like_gear_parts(_part_names_from_program(data)):
                    return path, data
    return None, None


def _part_names_from_program(program: dict[str, Any]) -> list[str]:
    names: list[str] = []
    for part in program.get("parts") or []:
        if isinstance(part, dict):
            pid = str(part.get("id") or part.get("name") or "").strip()
            if pid:
                names.append(pid)
        elif part:
            names.append(str(part))
    return names


def _joints_from_program(program: dict[str, Any]) -> list[dict[str, Any]]:
    from backend.services.urdf_acceptance import joint_limits_si, normalized_axis
    from backend.services.rigging_service import _joint_anchor_m

    units = program.get("units") or {}
    out: list[dict[str, Any]] = []
    for raw in program.get("joints") or []:
        if not isinstance(raw, dict):
            continue
        jtype = str(raw.get("overlay_type") or raw.get("type") or "fixed").strip().lower()
        if jtype == "slider":
            jtype = "prismatic"
        parent = str(raw.get("parent") or raw.get("parent_link") or "").strip()
        child = str(raw.get("child") or raw.get("child_link") or "").strip()
        if not parent or not child:
            continue
        joint = {
            "id": str(raw.get("id") or raw.get("name") or f"{parent}_{child}"),
            "type": jtype,
            "parent": parent,
            "child": child,
            "axis": normalized_axis(raw.get("axis", [0.0, 0.0, 1.0])),
            "anchor_m": _joint_anchor_m(raw, length_unit=str(units.get("length") or "mm")),
            "limits_si": joint_limits_si({**raw, "type": jtype}, length_unit=str(units.get("joint_length") or "mm"), angle_unit=str(units.get("angle") or "deg")),
            "mimic": raw.get("mimic"),
        }
        out.append(joint)
    return out


def _looks_like_gear_parts(names: list[str]) -> bool:
    blob = " ".join(names)
    if SUN_NAME_RE.search(blob) and PLANET_NAME_RE.search(blob):
        return True
    hits = 0
    for name in names:
        if GEAR_HINT_RE.search(name) or SUN_NAME_RE.search(name) or PLANET_NAME_RE.search(name) or CARRIER_NAME_RE.search(name):
            hits += 1
    return hits >= 2


def _stage_index(name: str) -> int:
    match = STAGE_RE.search(name)
    if match:
        try:
            return int(match.group(1))
        except ValueError:
            return 1
    return 1


def _planet_index(name: str) -> int:
    match = PLANET_INDEX_RE.search(_norm(name))
    if match:
        try:
            return int(match.group(1))
        except ValueError:
            return 1
    return 1


def _classify_part(name: str) -> str:
    n = _norm(name)
    if PLANET_NAME_RE.search(n) and not PIN_NAME_RE.search(n):
        return "planet"
    if PIN_NAME_RE.search(n):
        return "pin"
    if SUN_NAME_RE.search(n) or n.endswith("_sun") or n.startswith("sun"):
        return "sun"
    if CARRIER_NAME_RE.search(n):
        return "carrier"
    if RING_NAME_RE.search(n):
        return "ring"
    if FIXED_NAME_RE.search(n):
        return "fixed"
    if GEAR_HINT_RE.search(n):
        return "gear"
    return "fixed"


def extract_planetary_stages(text: str, part_names: list[str] | None = None) -> list[dict[str, Any]]:
    """Best-effort sun/planet/ring tooth counts from CAD source or program meta."""
    stages: list[dict[str, Any]] = []
    blob = str(text or "")
    for match in STAGE_ROW_RE.finditer(blob):
        stages.append(
            {
                "index": int(match.group(1)),
                "planet": int(match.group(2)),
                "ring": int(match.group(3)),
                "sun": 18,
            }
        )
    suns = [int(n) for n in SUN_GEAR_CALL_RE.findall(blob)]
    if stages and suns:
        for i, stage in enumerate(stages):
            stage["sun"] = suns[min(i, len(suns) - 1)]
    if not stages:
        names = part_names or []
        max_stage = 1
        for name in names:
            max_stage = max(max_stage, _stage_index(name))
        if _looks_like_gear_parts(names):
            for i in range(1, max_stage + 1):
                stages.append({"index": i, "sun": 18, "planet": 18 if i == 1 else 27, "ring": 54 if i == 1 else 72})
    for stage in stages:
        sun = max(1, int(stage.get("sun") or 18))
        ring = max(1, int(stage.get("ring") or 54))
        planet = max(1, int(stage.get("planet") or 18))
        stage["sun"] = sun
        stage["ring"] = ring
        stage["planet"] = planet
        stage["carrier_ratio"] = sun / float(sun + ring)
        stage["planet_spin_ratio"] = -(sun / float(planet)) * (ring / float(sun + ring))
    return stages


def _source_text_for_file(project_path: Path, filename: str | None) -> str:
    chunks: list[str] = [str(filename or "")]
    for path in _candidates_for_stem(project_path, filename):
        if path.suffix.lower() in {".py", ".md", ".json"} or path.name.lower().endswith(".vibecad.py"):
            try:
                if path.stat().st_size > 400_000:
                    continue
                chunks.append(path.read_text(encoding="utf-8", errors="ignore")[:120000])
            except OSError:
                continue
    return "\n".join(chunks)


def _existing_artifacts_for_stem(project_path: Path, filename: str | None) -> dict[str, str | None]:
    stem = model_stem(filename or "")
    urdf = srdf = None
    for rel in robot_artifact_names(project_path):
        art_stem = model_stem(rel)
        if stem and art_stem.lower() != stem.lower():
            continue
        lower = rel.lower()
        if lower.endswith(".urdf"):
            urdf = rel
        elif lower.endswith(".srdf"):
            srdf = rel
    return {"urdf": urdf, "srdf": srdf}


def _hint_text(project_path: Path, filename: str | None, prompt: str | None = None) -> str:
    bits = [str(filename or ""), str(prompt or "")]
    for path in _candidates_for_stem(project_path, filename):
        bits.append(path.name)
        if path.suffix.lower() == ".json":
            data = _read_json(path)
            if data:
                bits.append(str(data.get("name") or data.get("model_name") or ""))
                bits.append(" ".join(str(x) for x in (data.get("expected_outputs") or [])[:40]))
                bits.append(" ".join(_part_names_from_program(data)[:40]))
    return "\n".join(bits)


def assess_mechanism(
    project_path: Path,
    filename: str | None = None,
    prompt: str | None = None,
) -> dict[str, Any]:
    """Return whether URDF/SRDF can be generated for this CAD file."""
    text = _hint_text(project_path, filename, prompt)
    manufacturing_only = bool(MANUFACTURING_ONLY_RE.search(text) and not REAL_ROBOT_RE.search(text))
    part_names = expected_part_names_for_file(project_path, filename)
    program_path, program = _program_for_file(project_path, filename)
    program_parts = _part_names_from_program(program or {})
    if program_parts and not part_names:
        part_names = program_parts
    joints = _joints_from_program(program or {})
    movable = [j for j in joints if str(j.get("type") or "").lower() in MOVABLE_JOINT_TYPES]
    gear_parts = _looks_like_gear_parts(part_names)
    gear_hint = bool(GEAR_HINT_RE.search(text) or gear_parts)
    robot_hint = bool(ROBOT_HINT_RE.search(text))
    source_text = _source_text_for_file(project_path, filename)
    stages = extract_planetary_stages(
        source_text if gear_hint else json.dumps((program or {}).get("meta") or {}),
        part_names,
    )
    meta_stages = ((program or {}).get("meta") or {}).get("stages") if program else None
    if isinstance(meta_stages, list) and meta_stages:
        stages = []
        for i, row in enumerate(meta_stages, start=1):
            if not isinstance(row, dict):
                continue
            stages.append(
                {
                    "index": i,
                    "sun": int(row.get("sun") or 18),
                    "planet": int(row.get("planet") or 18),
                    "ring": int(row.get("ring") or 54),
                }
            )
        stages = extract_planetary_stages("", None) and stages  # keep computed ratios
        staged = []
        for row in stages:
            sun = max(1, int(row.get("sun") or 18))
            ring = max(1, int(row.get("ring") or 54))
            planet = max(1, int(row.get("planet") or 18))
            staged.append(
                {
                    **row,
                    "sun": sun,
                    "planet": planet,
                    "ring": ring,
                    "carrier_ratio": sun / float(sun + ring),
                    "planet_spin_ratio": -(sun / float(planet)) * (ring / float(sun + ring)),
                }
            )
        stages = staged
    artifacts = _existing_artifacts_for_stem(project_path, filename)
    kind = None
    reason = "No moving parts detected."
    can = False
    if manufacturing_only:
        kind = None
        reason = "Prompt is manufacturing/fixture CAD, not a kinematic mechanism."
    elif gear_parts or (gear_hint and (part_names or movable)):
        kind = "planetary_gear" if (SUN_NAME_RE.search(" ".join(part_names)) or "planet" in " ".join(part_names).lower()) else "gear_train"
        can = True
        reason = f"Detected {kind.replace('_', ' ')} with {len(part_names) or len(movable)} named parts."
        if movable:
            reason = f"Program already has {len(movable)} movable joint(s)."
    elif movable:
        kind = "mechanism"
        can = True
        reason = f"Program already has {len(movable)} movable joint(s)."
    elif robot_hint and python_sources(project_path):
        kind = "robot"
        can = True
        reason = "Prompt looks articulated; URDF/SRDF can be authored from the CAD Python source."
    return {
        "can_generate": can,
        "kind": kind,
        "reason": reason,
        "filename": filename,
        "stem": model_stem(filename or ""),
        "part_names": part_names,
        "stages": stages,
        "movable_joint_count": len(movable),
        "program": project_rel(Path(project_path), program_path) if program_path else None,
        "has_urdf": bool(artifacts["urdf"]),
        "has_srdf": bool(artifacts["srdf"]),
        "urdf": artifacts["urdf"],
        "srdf": artifacts["srdf"],
        "auto_play": bool(can and kind in {"planetary_gear", "gear_train", "mechanism"}),
        "skip_ask": bool(can and kind in {"planetary_gear", "gear_train", "mechanism"}),
    }


def _indent(elem: ET.Element, level: int = 0) -> None:
    pad = "\n" + "  " * level
    if len(elem):
        if not (elem.text or "").strip():
            elem.text = pad + "  "
        for child in elem:
            _indent(child, level + 1)
            if not (child.tail or "").strip():
                child.tail = pad + "  "
        if not (elem[-1].tail or "").strip():
            elem[-1].tail = pad
    elif level and not (elem.tail or "").strip():
        elem.tail = pad


def joints_to_urdf(
    *,
    name: str,
    part_names: list[str],
    joints: list[dict[str, Any]],
    mesh_by_part: dict[str, str] | None = None,
) -> str:
    from backend.services.urdf_acceptance import bind_assembled_meshes, finite_vector, joint_limits_si, normalized_axis

    robot = ET.Element("robot", {"name": _robot_xml_name(name)})
    anchors = {str(joint.get("child")): finite_vector(joint.get("anchor_m", [0, 0, 0])) for joint in joints}
    links = set(part_names)
    for joint in joints:
        links.add(str(joint.get("parent") or ""))
        links.add(str(joint.get("child") or ""))
    links.discard("")
    if "world" not in links and any(j.get("parent") == "world" for j in joints):
        links.add("world")
    for link_name in sorted(links, key=lambda n: (n != "world", n)):
        link = ET.SubElement(robot, "link", {"name": link_name})
        if link_name == "world":
            continue
    for joint in joints:
        jtype = str(joint.get("type") or "fixed").lower()
        if jtype not in {"fixed", "continuous", "prismatic", "revolute"}:
            raise ValueError(f"Joint type {jtype} requires an explicit robot representation")
        node = ET.SubElement(robot, "joint", {"name": str(joint.get("id") or "joint"), "type": jtype})
        ET.SubElement(node, "parent", {"link": str(joint.get("parent") or "world")})
        ET.SubElement(node, "child", {"link": str(joint.get("child") or "")})
        anchor = finite_vector(joint.get("anchor_m", [0, 0, 0]))
        parent_anchor = anchors.get(str(joint.get("parent")), [0, 0, 0])
        anchor = [value - parent_anchor[axis] for axis, value in enumerate(anchor)]
        ET.SubElement(node, "origin", {"xyz": f"{float(anchor[0])} {float(anchor[1])} {float(anchor[2])}", "rpy": "0 0 0"})
        axis = normalized_axis(joint.get("axis", [0.0, 0.0, 1.0]))
        ET.SubElement(node, "axis", {"xyz": f"{float(axis[0])} {float(axis[1])} {float(axis[2])}"})
        mimic = joint.get("mimic")
        if isinstance(mimic, dict) and mimic.get("joint"):
            ET.SubElement(
                node,
                "mimic",
                {
                    "joint": str(mimic["joint"]),
                    "multiplier": str(mimic.get("multiplier", 1.0)),
                    "offset": str(mimic.get("offset", 0.0)),
                },
            )
        if jtype in {"revolute", "prismatic"}:
            limits = joint.get("limits_si")
            if limits is None:
                limits = joint_limits_si(joint)
            lo, hi = limits
            ET.SubElement(node, "limit", {"lower": str(lo), "upper": str(hi), "effort": "10", "velocity": "10"})
    _indent(robot)
    xml = ET.tostring(robot, encoding="unicode")
    return bind_assembled_meshes(xml, mesh_by_part or {})[0]


def joints_to_srdf(*, name: str, joints: list[dict[str, Any]], stages: list[dict[str, Any]] | None = None) -> str:
    robot = ET.Element("robot", {"name": _robot_xml_name(name)})
    movable = [
        j
        for j in joints
        if str(j.get("type") or "").lower() in MOVABLE_JOINT_TYPES
    ]
    independent = [j for j in movable if not (isinstance(j.get("mimic"), dict) and j["mimic"].get("joint"))]
    if movable:
        group = ET.SubElement(robot, "group", {"name": "drive"})
        for joint in movable:
            ET.SubElement(group, "joint", {"name": str(joint.get("id"))})
        state = ET.SubElement(robot, "group_state", {"name": "home", "group": "drive"})
        for joint in independent:
            ET.SubElement(state, "joint", {"name": str(joint.get("id")), "value": "0"})
    if stages:
        for stage in stages:
            idx = int(stage.get("index") or 1)
            group = ET.SubElement(robot, "group", {"name": f"stage_{idx}"})
            prefix = f"s{idx}_"
            alt = f"stage_{idx}_"
            for joint in movable:
                jid = str(joint.get("id") or "")
                child = str(joint.get("child") or "")
                if prefix in jid or alt in jid or prefix in child or alt in child:
                    ET.SubElement(group, "joint", {"name": jid})
    adjacent: set[tuple[str, str]] = set()
    for joint in joints:
        a = str(joint.get("parent") or "")
        b = str(joint.get("child") or "")
        if not a or not b or a == "world":
            continue
        pair = tuple(sorted((a, b)))
        if pair in adjacent:
            continue
        adjacent.add(pair)
        ET.SubElement(
            robot,
            "disable_collisions",
            {"link1": pair[0], "link2": pair[1], "reason": "Adjacent"},
        )
    _indent(robot)
    return '<?xml version="1.0"?>\n' + ET.tostring(robot, encoding="unicode")


def _root_part(names: list[str]) -> str:
    for cand in ("housing", "base", "base_link", "frame", "case"):
        for name in names:
            if _norm(name) == cand or _norm(name).endswith(f"_{cand}"):
                return name
    return names[0] if names else "base_link"


def _carrier_for_stage(names: list[str], stage: int) -> str | None:
    carriers = [n for n in names if _classify_part(n) == "carrier" and _stage_index(n) == stage]
    if not carriers:
        carriers = [n for n in names if _classify_part(n) == "carrier"]
    # Prefer the drive/output carrier over a closure plate.
    for name in carriers:
        if "drive" in _norm(name) or "output" in _norm(name):
            return name
    return carriers[0] if carriers else None


def synthesize_planetary_joints(part_names: list[str], stages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    names = [n for n in part_names if n]
    if not names:
        return []
    housing = _root_part(names)
    joints: list[dict[str, Any]] = [
        {
            "id": "world_fixed",
            "type": "fixed",
            "parent": "world",
            "child": housing,
            "axis": [0.0, 0.0, 1.0],
            "anchor_m": [0.0, 0.0, 0.0],
        }
    ]
    used_children = {housing}
    drive_joint: str | None = None
    previous_carrier_joint: str | None = None
    stage_rows = stages or [{"index": 1, "sun": 18, "planet": 18, "ring": 54, "carrier_ratio": 0.25, "planet_spin_ratio": -0.75}]

    for stage in stage_rows:
        idx = int(stage.get("index") or 1)
        carrier_ratio = float(stage.get("carrier_ratio") or 0.25)
        planet_spin = float(stage.get("planet_spin_ratio") or -0.75)
        suns = [n for n in names if _classify_part(n) == "sun" and _stage_index(n) == idx]
        if not suns:
            suns = [n for n in names if _classify_part(n) == "sun"]
        carrier = _carrier_for_stage(names, idx)
        planets = [n for n in names if _classify_part(n) == "planet" and _stage_index(n) == idx]
        if not planets:
            planets = [n for n in names if _classify_part(n) == "planet"]
        rings = [n for n in names if _classify_part(n) == "ring" and _stage_index(n) == idx]

        sun = suns[0] if suns else None
        if idx == 1 and sun:
            jid = f"s{idx}_sun_axle"
            joints.append(
                {
                    "id": jid,
                    "type": "continuous",
                    "parent": housing,
                    "child": sun,
                    "axis": [0.0, 0.0, 1.0],
                    "anchor_m": [0.0, 0.0, 0.0],
                }
            )
            used_children.add(sun)
            drive_joint = jid
        elif sun and previous_carrier_joint:
            # Coupled sun follows the previous carrier (two-stage planetary).
            joints.append(
                {
                    "id": f"s{idx}_sun_coupled",
                    "type": "continuous",
                    "parent": housing,
                    "child": sun,
                    "axis": [0.0, 0.0, 1.0],
                    "anchor_m": [0.0, 0.0, 0.0],
                    "mimic": {"joint": previous_carrier_joint, "multiplier": 1.0, "offset": 0.0},
                }
            )
            used_children.add(sun)

        if carrier:
            jid = f"s{idx}_carrier_axle"
            mimic = None
            if drive_joint:
                # Compound ratio from the input sun through prior stages.
                multiplier = carrier_ratio
                if idx > 1:
                    prior = 1.0
                    for earlier in stage_rows:
                        if int(earlier.get("index") or 1) < idx:
                            prior *= float(earlier.get("carrier_ratio") or 0.25)
                    multiplier = prior * carrier_ratio if drive_joint else carrier_ratio
                    # Carrier2 = A * r1 * r2; sun axle is A, so multiplier = r1*r2.
                mimic = {"joint": drive_joint, "multiplier": multiplier, "offset": 0.0}
            joints.append(
                {
                    "id": jid,
                    "type": "continuous",
                    "parent": housing,
                    "child": carrier,
                    "axis": [0.0, 0.0, 1.0],
                    "anchor_m": [0.0, 0.0, 0.0],
                    "mimic": mimic,
                }
            )
            used_children.add(carrier)
            previous_carrier_joint = jid
            for extra in [n for n in names if _classify_part(n) == "carrier" and n != carrier and _stage_index(n) == idx]:
                joints.append(
                    {
                        "id": f"{_norm(extra)}_fixed",
                        "type": "fixed",
                        "parent": carrier,
                        "child": extra,
                        "axis": [0.0, 0.0, 1.0],
                        "anchor_m": [0.0, 0.0, 0.0],
                    }
                )
                used_children.add(extra)

        for planet in planets:
            pidx = _planet_index(planet)
            parent = carrier or housing
            mimic = None
            if drive_joint:
                # Relative planet spin vs input sun, including prior-stage compound.
                multiplier = planet_spin
                if idx > 1:
                    prior = 1.0
                    for earlier in stage_rows:
                        if int(earlier.get("index") or 1) < idx:
                            prior *= float(earlier.get("carrier_ratio") or 0.25)
                    multiplier = prior * planet_spin
                mimic = {"joint": drive_joint, "multiplier": multiplier, "offset": 0.0}
            joints.append(
                {
                    "id": f"s{idx}_planet_{pidx}_spin",
                    "type": "continuous",
                    "parent": parent,
                    "child": planet,
                    "axis": [0.0, 0.0, 1.0],
                    "anchor_m": [0.0, 0.0, 0.0],
                    "mimic": mimic,
                }
            )
            used_children.add(planet)

        for ring in rings:
            joints.append(
                {
                    "id": f"{_norm(ring)}_fixed",
                    "type": "fixed",
                    "parent": housing,
                    "child": ring,
                    "axis": [0.0, 0.0, 1.0],
                    "anchor_m": [0.0, 0.0, 0.0],
                }
            )
            used_children.add(ring)

    for name in names:
        if name in used_children:
            continue
        parent = housing
        if _classify_part(name) in {"pin"}:
            parent = _carrier_for_stage(names, _stage_index(name)) or housing
        elif "input" in _norm(name) and "clamp" in _norm(name):
            suns = [n for n in names if _classify_part(n) == "sun"]
            parent = suns[0] if suns else housing
        elif "output" in _norm(name) and "clamp" in _norm(name):
            parent = _carrier_for_stage(names, max((_stage_index(n) for n in names), default=1)) or housing
        joints.append(
            {
                "id": f"{_norm(name)}_fixed",
                "type": "fixed",
                "parent": parent,
                "child": name,
                "axis": [0.0, 0.0, 1.0],
                "anchor_m": [0.0, 0.0, 0.0],
            }
        )
        used_children.add(name)
    return joints


def _add_planetary_mimics(joints: list[dict[str, Any]], stages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Attach mimic tags onto existing program joints when stages are known."""
    if not stages:
        return joints
    by_child = {str(j.get("child") or ""): j for j in joints}
    suns = [j for j in joints if str(j.get("type")) in MOVABLE_JOINT_TYPES and _classify_part(str(j.get("child") or "")) == "sun"]
    if not suns:
        return joints
    drive = suns[0]
    drive_id = str(drive.get("id"))
    for joint in joints:
        child = str(joint.get("child") or "")
        kind = _classify_part(child)
        if kind not in {"carrier", "planet", "sun"}:
            continue
        if str(joint.get("id")) == drive_id:
            continue
        if joint.get("mimic"):
            continue
        idx = _stage_index(child)
        stage = next((s for s in stages if int(s.get("index") or 1) == idx), stages[0])
        if kind == "carrier":
            multiplier = float(stage.get("carrier_ratio") or 0.25)
            if idx > 1:
                prior = 1.0
                for earlier in stages:
                    if int(earlier.get("index") or 1) < idx:
                        prior *= float(earlier.get("carrier_ratio") or 0.25)
                multiplier = prior * float(stage.get("carrier_ratio") or 0.25)
            joint["mimic"] = {"joint": drive_id, "multiplier": multiplier, "offset": 0.0}
        elif kind == "planet":
            multiplier = float(stage.get("planet_spin_ratio") or -0.75)
            if idx > 1:
                prior = 1.0
                for earlier in stages:
                    if int(earlier.get("index") or 1) < idx:
                        prior *= float(earlier.get("carrier_ratio") or 0.25)
                multiplier = prior * float(stage.get("planet_spin_ratio") or -0.75)
            joint["mimic"] = {"joint": drive_id, "multiplier": multiplier, "offset": 0.0}
        elif kind == "sun" and idx > 1:
            prior_carrier = None
            for cand in joints:
                if _classify_part(str(cand.get("child") or "")) == "carrier" and _stage_index(str(cand.get("child") or "")) == idx - 1:
                    prior_carrier = cand
            if prior_carrier:
                joint["mimic"] = {"joint": str(prior_carrier.get("id")), "multiplier": 1.0, "offset": 0.0}
        _ = by_child
    return joints


def _output_dir_for_file(project_path: Path, filename: str | None) -> Path:
    root = Path(project_path)
    raw = str(filename or "").replace("\\", "/").strip()
    if raw:
        try:
            path = safe_project_path(root, raw)
            if path.parent != root and path.parent.name in ENGINE_FOLDER_SET:
                return path.parent
        except ValueError:
            pass
        parent = Path(raw).parent.name
        if parent in ENGINE_FOLDER_SET:
            dest = root / parent
            dest.mkdir(parents=True, exist_ok=True)
            return dest
    return root


def relabel_glb_bodies(glb_path: Path, names: list[str]) -> bool:
    """Rename generic Body N meshes to the CAD solid names (expected_outputs)."""
    dest = Path(glb_path)
    if not dest.is_file() or dest.suffix.lower() not in {".glb", ".gltf"} or not names:
        return False
    try:
        import trimesh
        from backend.services.cad_service import _scene_geometry_entries, export_scene
    except Exception:
        return False
    try:
        scene = trimesh.load(str(dest), force="scene")
    except Exception as exc:
        logger.debug("Could not open GLB to relabel (%s): %s", dest.name, exc)
        return False
    if not isinstance(scene, trimesh.Scene):
        return False
    entries = _scene_geometry_entries(scene, source_path=dest)
    if len(entries) < 2:
        return False
    count = min(len(entries), len(names))
    changed = False
    rebuilt = trimesh.Scene()
    used: set[str] = set()
    for idx, (node_name, geom_name, geom, world) in enumerate(entries):
        label = names[idx] if idx < count else (node_name or geom_name or f"Body {idx + 1}")
        if idx < count and _norm(node_name) != _norm(label):
            changed = True
        geom_id = re.sub(r"[^\w\-]+", "_", str(label)).strip("_") or f"body_{idx + 1:02d}"
        if geom_id in used:
            geom_id = f"{geom_id}_{idx + 1:02d}"
        used.add(geom_id)
        cloned = geom.copy() if hasattr(geom, "copy") else geom
        try:
            rebuilt.add_geometry(cloned, geom_name=geom_id, node_name=str(label), transform=world)
        except TypeError:
            rebuilt.add_geometry(cloned, geom_name=geom_id, node_name=str(label))
    if not changed:
        return False
    try:
        export_scene(rebuilt, dest)
        return True
    except Exception as exc:
        logger.debug("Could not export relabeled GLB (%s): %s", dest.name, exc)
        return False


def generate_mechanism_artifacts(
    project_path: Path,
    filename: str | None,
    *,
    kind: str = "both",
    prompt: str | None = None,
    force: bool = False,
) -> dict[str, Any]:
    """Write URDF and/or SRDF beside the CAD model when assessment says yes."""
    assessment = assess_mechanism(project_path, filename, prompt)
    want_urdf = kind in {"urdf", "both"}
    want_srdf = kind in {"srdf", "both"}
    if not assessment.get("can_generate") and not force:
        return {**assessment, "outputs": [], "relabeled_glb": False, "message": assessment.get("reason")}
    if assessment.get("kind") == "robot" and not assessment.get("part_names") and not assessment.get("movable_joint_count"):
        return {
            **assessment,
            "outputs": [],
            "relabeled_glb": False,
            "needs_author": True,
            "message": "Use AI authoring for this articulated model (no named gear parts or program joints).",
        }

    stem = assessment.get("stem") or model_stem(filename or "mechanism")
    out_dir = _output_dir_for_file(project_path, filename)
    part_names = list(assessment.get("part_names") or [])
    stages = list(assessment.get("stages") or [])
    _program_path, program = _program_for_file(project_path, filename)
    from backend.services.urdf_acceptance import accepted_urdf_is_current, capture_dependencies, publish_urdf

    dependency_paths = [_program_path] if _program_path else []
    if filename:
        target = safe_project_path(Path(project_path), filename)
        if target.is_file():
            dependency_paths.append(target)
    dependencies = capture_dependencies(Path(project_path), dependency_paths)
    joints = _joints_from_program(program or {})
    mesh_by_part: dict[str, str] = {}
    if program:
        for pid in _part_names_from_program(program):
            stl = out_dir / f"{stem}_{pid}.stl"
            if not stl.is_file():
                stl = Path(project_path) / f"{stem}_{pid}.stl"
            if stl.is_file():
                mesh_by_part[pid] = Path(os.path.relpath(stl, out_dir)).as_posix()
    if not joints:
        return {**assessment, "outputs": [], "relabeled_glb": False, "needs_author": True,
                "message": "Author joint frames and limits before generating robot artifacts."}

    relabeled = False
    outputs: list[dict[str, str]] = []
    urdf_rel = assessment.get("urdf")
    srdf_rel = assessment.get("srdf")
    acceptance = None
    if want_urdf and (force or not urdf_rel or not accepted_urdf_is_current(Path(project_path) / urdf_rel, Path(project_path))):
        urdf_path = out_dir / f"{stem}.urdf"
        acceptance = publish_urdf(
            urdf_path,
            joints_to_urdf(name=stem, part_names=part_names or [j["child"] for j in joints], joints=joints, mesh_by_part=mesh_by_part),
            project_root=Path(project_path), expected_dependencies=dependencies,
        )
        urdf_rel = project_rel(Path(project_path), urdf_path)
        outputs.append({"filename": urdf_rel, "kind": "urdf"})
    if want_srdf and (force or not srdf_rel):
        srdf_path = out_dir / f"{stem}.srdf"
        srdf_path.write_text(joints_to_srdf(name=stem, joints=joints, stages=stages), encoding="utf-8")
        srdf_rel = project_rel(Path(project_path), srdf_path)
        outputs.append({"filename": srdf_rel, "kind": "srdf"})

    message = "Generated " + ", ".join(o["filename"] for o in outputs) if outputs else "Mechanism artifacts already present."
    if relabeled:
        message += " Relabeled CAD bodies to match part names."
    return {
        **assessment,
        "has_urdf": bool(urdf_rel),
        "has_srdf": bool(srdf_rel),
        "urdf": urdf_rel,
        "srdf": srdf_rel,
        "outputs": outputs,
        "relabeled_glb": relabeled,
        "needs_author": False,
        "urdf_acceptance": acceptance,
        "message": message,
        "joint_count": len(joints),
        "movable_joint_count": len([j for j in joints if str(j.get("type")) in MOVABLE_JOINT_TYPES]),
    }


def maybe_write_artifacts(project_path: Path, filename: str | None, prompt: str | None = None) -> dict[str, Any] | None:
    """Silent post-CAD hook: write URDF/SRDF when the new model is a mechanism."""
    try:
        assessment = assess_mechanism(project_path, filename, prompt)
        if not assessment.get("can_generate") or assessment.get("kind") == "robot":
            return None
        from backend.services.urdf_acceptance import accepted_urdf_is_current

        if assessment.get("has_urdf") and assessment.get("has_srdf") and accepted_urdf_is_current(Path(project_path) / assessment["urdf"], Path(project_path)):
            return assessment
        return generate_mechanism_artifacts(project_path, filename, prompt=prompt)
    except Exception as exc:
        logger.warning("mechanism motion artifacts failed for %s: %s", filename, exc)
        return None
