"""Portable joint intent alongside STEP B-rep. Native CAD mates need an adapter.

The STEP comment is deliberately metadata, not fake marker solids or a claim
of AP242 kinematics support. Standard CAD readers ignore it; our importer reads
it without executing model-provided code. The original STEP entities stay intact.
"""
from __future__ import annotations

import base64
import io
import json
import re
import zipfile
from pathlib import Path

_BLOCK = re.compile(rb"/\* RENDER3D_JOINTS_V1\s+([A-Za-z0-9+/=\s]+?)\s+END_RENDER3D_JOINTS \*/\r?\n?")
MAX_METADATA_BYTES = 2_000_000


def joint_payload(rows: list[dict], *, stem: str | None = None) -> dict:
    return {
        "schema": "render3d.joints/1",
        "source": "render-studio",
        "stem": stem,
        "units": {"length": "mm", "angle": "deg"},
        "coordinate_frame": "assembled_model",
        "joints": rows,
        "native_mates": False,
    }


def pack_step_joints(data: bytes, payload: dict) -> bytes:
    if not data.lstrip().startswith(b"ISO-10303-21;"):
        raise ValueError("Joint metadata requires a STEP file, not raw BREP or mesh data")
    clean = _BLOCK.sub(b"", data)
    raw = json.dumps(payload, ensure_ascii=True, allow_nan=False, separators=(",", ":")).encode()
    if len(raw) > MAX_METADATA_BYTES:
        raise ValueError("Joint metadata exceeds the export limit")
    if not payload.get("joints"):
        return clean
    encoded = base64.b64encode(raw)
    block = b"/* RENDER3D_JOINTS_V1\n" + b"\n".join(encoded[i:i+100] for i in range(0, len(encoded), 100)) + b"\nEND_RENDER3D_JOINTS */\n"
    at = clean.index(b"ISO-10303-21;") + len(b"ISO-10303-21;")
    # Place the comment before HEADER without changing any existing entities.
    return clean[:at] + b"\n" + block.rstrip(b"\n") + clean[at:]


def unpack_step_joints(data: bytes) -> dict | None:
    match = _BLOCK.search(data)
    if not match or len(match[1]) > MAX_METADATA_BYTES * 2:
        return None
    try:
        payload = json.loads(base64.b64decode(re.sub(rb"\s", b"", match[1]), validate=True))
    except (ValueError, TypeError):
        return None
    if not isinstance(payload, dict) or payload.get("schema") != "render3d.joints/1":
        return None
    return payload


def model_joint_export(project_path: Path, step_path: Path) -> tuple[bytes, dict]:
    from backend.services.cad_harness import load_harness_joints
    rel = step_path.relative_to(project_path).with_suffix("").as_posix()
    for suffix in (".fusionpart", ".part"):
        if rel.endswith(suffix):
            rel = rel[:-len(suffix)]
    rows = load_harness_joints(project_path, stem=rel)
    payload = joint_payload(rows, stem=rel)
    return pack_step_joints(step_path.read_bytes(), payload), payload


def joint_export_bundle(project_path: Path, step_path: Path) -> bytes:
    data, payload = model_joint_export(project_path, step_path)
    if not payload["joints"]:
        raise ValueError("This model has no authored joints yet")
    from backend.services.assembly_motion import assembly_info, joint_folder_file
    from backend.services.joint_compatibility import export_compatibility
    info = assembly_info(project_path, payload['stem'])
    compatibility = export_compatibility(payload['joints'], info['native'])
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(step_path.name, data)
        archive.writestr(step_path.stem + ".joints.json", json.dumps(payload, indent=2, allow_nan=False))
        importer = Path(__file__).parent.parent / "cad_adapters" / "RenderStudioJoints.py"
        archive.write(importer, "RenderStudioJoints/RenderStudioJoints.py")
        archive.writestr("RenderStudioJoints/RenderStudioJoints.manifest", json.dumps({
            "autodeskProduct": "Fusion360", "type": "script", "author": "Render Studio",
            "description": {"": "Import a Render Studio STEP assembly and recreate its joints."},
            "version": "1.0.0", "supportedOS": "windows|mac",
        }))
        archive.writestr("compatibility.json", json.dumps(compatibility, indent=2))
        if info['native'].get('ok'):
            native = joint_folder_file(project_path, payload['stem'], '.FCStd')
            if native.is_file(): archive.write(native, step_path.stem + '.FCStd')
        archive.writestr("README.txt", BUNDLE_README)
    return output.getvalue()


BUNDLE_README = """Render Studio assembly export

BREP/STEP is not a universal joint format. Joint definitions round-trip in Render
Studio; native mates in another CAD app require an app-specific importer.
Read compatibility.json for per-app coverage and unimplemented constraints.
An included FCStd is the native FreeCAD assembly validated against this STEP.
It is not a native Fusion, Onshape, or SolidWorks document.

STEP: editable B-rep bodies and names, plus embedded Render Studio joint metadata.
JSON: parent/child component names, pivot and axis in assembled-model coordinates,
millimetres and degrees, and joint limits. This is not a native CAD assembly file.

Fusion: unzip. Utilities > Scripts and Add-ins > Scripts > add the
RenderStudioJoints folder, then Run. Choose the included STEP. The script opens a
NEW design and recreates fixed, revolute, slider, cylindrical and ball joints.
It reports unresolved/ambiguous components and unsupported data rather than
claiming all joints succeeded. Save the resulting design in Fusion as usual.

Onshape / SolidWorks: import STEP as an assembly, preserving separate components.
Their standard STEP importers do not consume Render Studio joint metadata.
Native mate recreation for these apps is not implemented. Use the JSON pivot,
axis and limits to create Fastened/Fixed, Revolute/Hinge, Slider, Cylindrical,
or Ball mates. Keep this package: CAD re-export may discard the metadata comment.

The script never uploads credentials or modifies an existing open design.
"""
