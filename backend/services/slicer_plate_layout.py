"""Bambu plate layout for VR preview — same packer as 3MF export, not a desktop window.

Quest Browser WebXR cannot embed Bambu Studio without a local GPU window-capture
bridge. This adapter returns numbered plates + part poses so VR can grab, reorient,
and talk to Astra. Token ``bambu1``. Never wipes logs.
"""

from __future__ import annotations

import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.services import cad_service
from backend.services import xr_debugger_service

TOKEN = "bambu1"
SIDECAR_DIR = "slicer-layout"
MAX_PARTS = 48
ALLOWED_CEDERS = frozenset({"astra", "cursor-engineer", "harness-mule"})

DESKTOP_IN_VR = {
    "supported": False,
    "reason": (
        "Bambu Studio is a native desktop GPU app. Quest Browser WebXR cannot "
        "embed that window without a local capture/bridge process. Plate preview "
        "uses the existing Export-to-Bambu 3MF packer plus this JSON adapter."
    ),
    "pc_open": "bambustudio://open?file= (macOS bambustudioopen://) on the workstation",
    "cli": "No supported Bambu Studio CLI for live plate edits; 3MF + project_settings.config is the API.",
}


def _num(value: Any, default: float = 0.0) -> float:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return default
    return n if math.isfinite(n) else default


def _settings_profile(raw: dict[str, Any] | None) -> dict[str, Any]:
    src = raw if isinstance(raw, dict) else {}
    filament = src.get("filament_type")
    if isinstance(filament, list):
        filament = filament[0] if filament else "PLA"
    infill = str(src.get("sparse_infill_density") or "15%").strip()
    pct = _num(re.sub(r"[^0-9.]", "", infill) or "15", 15.0)
    supports = str(src.get("enable_support") or "0") in {"1", "true", "True"}
    return {
        "filament": str(filament or "PLA")[:24],
        "supports_enabled": supports,
        "infill_pct": pct,
        "infill_pattern": str(src.get("sparse_infill_pattern") or "grid")[:32],
        "bed_type": str(src.get("curr_bed_type") or "Textured PEI Plate")[:48],
        "printer_model": str(src.get("printer_model") or src.get("printer_settings_id") or "Bambu Lab")[:64],
        "plate_orientation": "flat",
    }


def sidecar_path(project_path: Path, filename: str) -> Path:
    stem = Path(str(filename or "model")).stem[:80] or "model"
    folder = Path(project_path) / SIDECAR_DIR
    folder.mkdir(parents=True, exist_ok=True)
    return folder / f"{stem}.json"


def load_sidecar(project_path: Path, filename: str) -> dict[str, Any] | None:
    path = sidecar_path(project_path, filename)
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def save_sidecar(project_path: Path, filename: str, layout: dict[str, Any]) -> Path:
    path = sidecar_path(project_path, filename)
    blob = dict(layout)
    blob["token"] = TOKEN
    blob["saved_at"] = datetime.now(timezone.utc).isoformat()
    path.write_text(json.dumps(blob, indent=2) + "\n", encoding="utf-8")
    return path


def parse_profile_bytes(raw: bytes) -> dict[str, Any]:
    try:
        obj = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return _settings_profile({})
    return _settings_profile(obj if isinstance(obj, dict) else {})


def layout_from_packed(
    bodies: list[dict[str, Any]],
    *,
    plate_of: list[int],
    seat_xy: list[tuple[float, float]],
    profile: dict[str, Any] | None = None,
    filename: str = "",
) -> dict[str, Any]:
    n = min(len(bodies), MAX_PARTS)
    plate_ids = [int(plate_of[i]) if i < len(plate_of) else 0 for i in range(n)]
    plate_count = (max(plate_ids) + 1) if plate_ids else 1
    parts = []
    for i in range(n):
        body = bodies[i]
        cx, cy = seat_xy[i] if i < len(seat_xy) else (128.0, 128.0)
        size = body.get("size_mm") or [20.0, 20.0, 10.0]
        sx, sy, sz = _num(size[0], 20), _num(size[1], 20), _num(size[2] if len(size) > 2 else 10, 10)
        plate_id = plate_ids[i] + 1
        parts.append({
            "id": str(body.get("id") or f"part-{i + 1}"),
            "name": str(body.get("name") or f"Part {i + 1}")[:80],
            "plate_id": plate_id,
            "center_mm": [round(cx, 3), round(cy, 3), round(sz / 2.0, 3)],
            "size_mm": [round(sx, 3), round(sy, 3), round(sz, 3)],
            "rotation_deg": [0.0, 0.0, 0.0],
            "oriented": bool(body.get("oriented")),
        })
    plates = []
    for idx in range(plate_count):
        ox, oy = cad_service._bambu_plate_origin(idx, plate_count)
        members = [p for p in parts if p["plate_id"] == idx + 1]
        name = members[0]["name"] if len(members) == 1 else f"Plate {idx + 1}"
        plates.append({
            "id": idx + 1,
            "name": name[:80],
            "origin_mm": [round(ox, 3), round(oy, 3)],
            "size_mm": [cad_service.THREEMF_BAMBU_BED_W, cad_service.THREEMF_BAMBU_BED_D],
            "part_ids": [p["id"] for p in members],
        })
    return {
        "ok": True,
        "token": TOKEN,
        "filename": str(filename or "")[:200],
        "desktop_in_vr": DESKTOP_IN_VR,
        "bed_mm": [cad_service.THREEMF_BAMBU_BED_W, cad_service.THREEMF_BAMBU_BED_D],
        "profile": profile or _settings_profile({}),
        "plates": plates,
        "parts": parts,
        "pointed_ids": [],
        "draw_selected_ids": [],
    }


def merge_sidecar(layout: dict[str, Any], sidecar: dict[str, Any] | None) -> dict[str, Any]:
    if not sidecar:
        return layout
    by_id = {str(p.get("id")): p for p in (sidecar.get("parts") or []) if isinstance(p, dict)}
    out_parts = []
    for part in layout.get("parts") or []:
        saved = by_id.get(str(part.get("id")))
        if not saved:
            out_parts.append(part)
            continue
        merged = dict(part)
        if isinstance(saved.get("center_mm"), list) and len(saved["center_mm"]) >= 2:
            merged["center_mm"] = [
                _num(saved["center_mm"][0], part["center_mm"][0]),
                _num(saved["center_mm"][1], part["center_mm"][1]),
                _num(saved["center_mm"][2] if len(saved["center_mm"]) > 2 else part["center_mm"][2], part["center_mm"][2]),
            ]
        if isinstance(saved.get("rotation_deg"), list) and len(saved["rotation_deg"]) >= 3:
            merged["rotation_deg"] = [_num(v) for v in saved["rotation_deg"][:3]]
        if saved.get("plate_id"):
            merged["plate_id"] = max(1, int(_num(saved.get("plate_id"), part["plate_id"])))
        merged["oriented"] = bool(saved.get("oriented") or part.get("oriented"))
        out_parts.append(merged)
    layout = dict(layout)
    layout["parts"] = out_parts
    if isinstance(sidecar.get("profile"), dict):
        layout["profile"] = {**(layout.get("profile") or {}), **sidecar["profile"]}
    # Rebuild plate member lists after moves.
    max_plate = max((int(p.get("plate_id") or 1) for p in out_parts), default=1)
    plates = []
    for idx in range(max_plate):
        members = [p for p in out_parts if int(p.get("plate_id") or 1) == idx + 1]
        ox, oy = cad_service._bambu_plate_origin(idx, max_plate)
        plates.append({
            "id": idx + 1,
            "name": members[0]["name"] if len(members) == 1 else f"Plate {idx + 1}",
            "origin_mm": [round(ox, 3), round(oy, 3)],
            "size_mm": [cad_service.THREEMF_BAMBU_BED_W, cad_service.THREEMF_BAMBU_BED_D],
            "part_ids": [p["id"] for p in members],
        })
    layout["plates"] = plates
    return layout


def rebuild_plates(layout: dict[str, Any]) -> dict[str, Any]:
    return merge_sidecar(layout, {"parts": layout.get("parts") or [], "profile": layout.get("profile") or {}})


def _mesh_size_mm(mesh: Any) -> list[float]:
    extents = getattr(mesh, "extents", None)
    if extents is None:
        return [20.0, 20.0, 10.0]
    arr = list(extents)
    return [_num(arr[0], 20), _num(arr[1] if len(arr) > 1 else 20, 20), _num(arr[2] if len(arr) > 2 else 10, 10)]


def build_layout(project_path: Path, filename: str) -> dict[str, Any]:
    """Compute the plate preview the exported 3MF will show in Bambu Studio."""
    path = Path(project_path)
    safe = cad_service.resolve_existing_project_file(path, filename)
    if not safe:
        found = cad_service.find_cad_file_for_stem(
            path,
            Path(filename).stem,
            {".glb", ".gltf", ".stl", ".step", ".stp", ".3mf", ".obj"},
        )
        safe = found.name if found is not None and found.is_file() else None
    if not safe:
        raise FileNotFoundError("File not found")
    src = cad_service.resolve_existing_project_file(path, safe) or Path(safe)
    if not Path(src).is_absolute():
        resolved = path / src
    else:
        resolved = Path(src)
    scene, source_path, multiplate = cad_service.scene_for_3mf_export(path, resolved)
    scene_items = cad_service._meshes_from_scene(scene, source_path=source_path)
    prepared: list[tuple[str, Any]] = []
    for name, raw in scene_items[:MAX_PARTS]:
        mesh = cad_service._prepare_mesh_for_3mf(raw)
        if mesh is None:
            continue
        prepared.append((name, mesh))
    if not prepared:
        raise ValueError("no geometry to preview")
    use_multi = bool(multiplate) and len(prepared) >= 2
    if not use_multi and len(prepared) > 1:
        try:
            import trimesh
            combined = trimesh.util.concatenate([m for _, m in prepared])
        except Exception:
            combined = prepared[0][1]
        merged = cad_service._prepare_mesh_for_3mf(combined)
        if merged is None:
            raise ValueError("no exportable geometry")
        label = cad_service._safe_object_name(Path(source_path or resolved).stem, "model")
        prepared = [(label, merged)]
    meshes = [m for _, m in prepared]
    plate_of, seat_xy = cad_service._assign_bambu_plates_packed(meshes)
    if not plate_of:
        plate_of = cad_service._assign_bambu_plate_indices(len(meshes))
        seat_xy = cad_service._pack_offsets_on_plate(meshes, allow_overflow=False)
    bodies = [
        {"id": f"part-{i + 1}", "name": name, "size_mm": _mesh_size_mm(mesh)}
        for i, (name, mesh) in enumerate(prepared)
    ]
    profile = parse_profile_bytes(cad_service._bambu_project_settings_bytes())
    layout = layout_from_packed(
        bodies, plate_of=plate_of, seat_xy=seat_xy, profile=profile, filename=str(safe),
    )
    return merge_sidecar(layout, load_sidecar(path, str(safe)))


def reorient_part(part: dict[str, Any], mode: str = "flat") -> dict[str, Any]:
    """Rotate so a large face sits on the bed (print orientation), keep XY center."""
    out = dict(part)
    size = list(out.get("size_mm") or [20, 20, 10])
    while len(size) < 3:
        size.append(10.0)
    sx, sy, sz = size[0], size[1], size[2]
    rot = list(out.get("rotation_deg") or [0, 0, 0])
    while len(rot) < 3:
        rot.append(0.0)
    kind = str(mode or "flat").strip().lower()
    if kind in {"flat", "lay_flat", "bed"}:
        # Smallest dimension becomes height (Z).
        if sz <= sx and sz <= sy:
            pass
        elif sx <= sy and sx <= sz:
            rot[1] = (rot[1] + 90) % 360
            out["size_mm"] = [sz, sy, sx]
        else:
            rot[0] = (rot[0] + 90) % 360
            out["size_mm"] = [sx, sz, sy]
    elif kind in {"flip", "upside_down"}:
        rot[0] = (rot[0] + 180) % 360
    elif kind in {"yaw90", "rotate", "90"}:
        rot[2] = (rot[2] + 90) % 360
        out["size_mm"] = [sy, sx, sz]
    elif kind in {"yaw180", "180"}:
        rot[2] = (rot[2] + 180) % 360
    out["rotation_deg"] = [round(_num(v) % 360, 2) for v in rot[:3]]
    z = _num((out.get("size_mm") or size)[2], sz) / 2.0
    cx, cy, _ = out.get("center_mm") or [128, 128, z]
    out["center_mm"] = [_num(cx), _num(cy), round(z, 3)]
    return out


def select_part_ids(layout: dict[str, Any], args: dict[str, Any]) -> list[str]:
    parts = [p for p in (layout.get("parts") or []) if isinstance(p, dict)]
    ids = [str(x) for x in (args.get("part_ids") or []) if x]
    if ids:
        known = {str(p.get("id")) for p in parts}
        return [i for i in ids if i in known][:MAX_PARTS]
    plate = args.get("plate_id")
    if plate:
        pid = int(_num(plate, 0))
        return [str(p.get("id")) for p in parts if int(p.get("plate_id") or 0) == pid]
    pointed = [str(x) for x in (args.get("pointed_ids") or layout.get("pointed_ids") or []) if x]
    if pointed:
        return pointed[:MAX_PARTS]
    drawn = [str(x) for x in (args.get("draw_selected_ids") or layout.get("draw_selected_ids") or []) if x]
    if drawn:
        return drawn[:MAX_PARTS]
    return [str(p.get("id")) for p in parts[:1] if p.get("id")]


def apply_command(layout: dict[str, Any], args: dict[str, Any]) -> dict[str, Any]:
    action = str(args.get("action") or "").strip().lower()
    next_layout = dict(layout)
    parts = [dict(p) for p in (layout.get("parts") or []) if isinstance(p, dict)]
    by_id = {str(p.get("id")): p for p in parts}
    ids = select_part_ids(layout, args)
    if action in {"reorient", "orient"}:
        mode = str(args.get("orientation") or args.get("mode") or "flat")
        for pid in ids:
            if pid in by_id:
                by_id[pid] = reorient_part(by_id[pid], mode)
        next_layout["parts"] = list(by_id.values())
    elif action in {"move"}:
        dx = _num(args.get("dx_mm"))
        dy = _num(args.get("dy_mm"))
        for pid in ids:
            part = by_id.get(pid)
            if not part:
                continue
            c = list(part.get("center_mm") or [128, 128, 5])
            part["center_mm"] = [
                max(6.0, min(cad_service.THREEMF_BAMBU_BED_W - 6.0, _num(c[0]) + dx)),
                max(6.0, min(cad_service.THREEMF_BAMBU_BED_D - 6.0, _num(c[1]) + dy)),
                _num(c[2] if len(c) > 2 else 5, 5),
            ]
            by_id[pid] = part
        next_layout["parts"] = list(by_id.values())
    elif action in {"assign_plate", "replate", "organize"}:
        plate_id = max(1, int(_num(args.get("plate_id"), 1)))
        for pid in ids:
            if pid in by_id:
                by_id[pid]["plate_id"] = plate_id
        next_layout["parts"] = list(by_id.values())
    elif action in {"set_profile"}:
        profile = dict(next_layout.get("profile") or {})
        if args.get("filament"):
            profile["filament"] = str(args.get("filament"))[:24]
        if args.get("supports_enabled") is not None:
            profile["supports_enabled"] = bool(args.get("supports_enabled"))
        if args.get("infill_pct") is not None:
            profile["infill_pct"] = max(0.0, min(100.0, _num(args.get("infill_pct"), 15)))
        next_layout["profile"] = profile
    elif action in {"confirm_oriented", "oriented", "cede_harness", "ping_group"}:
        for pid in ids:
            if pid in by_id:
                by_id[pid]["oriented"] = True
        next_layout["parts"] = list(by_id.values())
        next_layout["last_action"] = action
    else:
        raise ValueError("unknown slicer layout action")
    return rebuild_plates(next_layout)


def debugger_payload(layout: dict[str, Any], args: dict[str, Any], *, user_id: str = "") -> dict[str, Any]:
    ids = select_part_ids(layout, args)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    return {
        "v": 1,
        "kind": "bambu-plate",
        "auto": False,
        "manual": True,
        "filename": f"{stamp}-bambu-plate.jsonl",
        "description": str(args.get("description") or "Plate orientation confirmed in VR")[:160],
        "actions": [{"t": 0, "tool": "slicer-plate"}],
        "extra": {
            "kind": "bambu-plate",
            "build": TOKEN,
            "filename": str(layout.get("filename") or "")[:80],
            "plate_id": int(_num(args.get("plate_id"), 0)),
            "part_ids": ids[:24],
            "oriented": True,
            "cede": str(args.get("action") or "") == "cede_harness",
            "user_id": str(user_id or "")[:40],
        },
    }


def write_plate_log(user: dict[str, Any] | None, layout: dict[str, Any], args: dict[str, Any]) -> dict[str, Any]:
    payload = debugger_payload(layout, args, user_id=str((user or {}).get("id") or ""))
    return xr_debugger_service.write_xr_perf_log(user or {"id": "anon"}, payload)


def ping_group(text: str, *, agent: str = "astra") -> dict[str, Any]:
    from backend.services import team_status_service

    body = str(text or "").strip()[:900]
    who = str(agent or "astra").strip().lower()
    if who not in ALLOWED_CEDERS:
        who = "astra"
    if not body:
        raise ValueError("text is required")
    return team_status_service.post_agent_chat(who, body)


def cede_harness(layout: dict[str, Any], args: dict[str, Any], *, log_name: str = "") -> dict[str, Any]:
    from backend.services import mcp_watchdog_service

    bug_id = str(args.get("bug_id") or "").strip()[:80]
    text = str(args.get("text") or args.get("description") or "VR/Astra slicer plate debug").strip()[:900]
    rec = {
        "agent": "astra",
        "to": "cursor-engineer",
        "text": (
            f"{text}\n"
            f"token=bambu1 log={log_name or '(pending)'} "
            f"filename={layout.get('filename')} plate={args.get('plate_id')} "
            f"bug_id={bug_id or '(none)'} "
            "cede back via rm_queue result; do not production-reset."
        ),
        "tickets": [t for t in (args.get("tickets") or []) if t][:8],
        "bug_id": bug_id,
        "reset": False,
    }
    queued = mcp_watchdog_service.rm_queue({
        "agent": "astra",
        "text": rec["text"],
        "tickets": rec["tickets"],
    })
    inbox = str((queued or {}).get("harness_inbox") or "")
    return {
        "ok": True,
        "ceded": True,
        "reset": False,
        "inbox": Path(inbox).name if inbox else "",
        "rm": queued,
        "bug_id": bug_id or None,
        "how": "Ask Cursor: send it over to the grok/harness agent. Result cedes via rm_queue; never auto-reset.",
    }
