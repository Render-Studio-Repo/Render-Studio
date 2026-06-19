"""Fusion-style edit timeline: snapshots per step, scrub to restore."""

from __future__ import annotations

import json
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.services import cad_service

_SNAPSHOT_SUFFIXES = {".stl", ".obj", ".glb", ".gltf", ".ply", ".off", ".3mf", ".step", ".stp"}


def _timeline_path(project_path: Path) -> Path:
    return project_path / "timeline.json"


def _history_dir(project_path: Path) -> Path:
    d = project_path / "history"
    d.mkdir(parents=True, exist_ok=True)
    return d


def load_timeline(project_path: Path) -> dict[str, Any]:
    path = _timeline_path(project_path)
    if not path.is_file():
        return {"current_index": -1, "entries": []}
    return json.loads(path.read_text())


def save_timeline(project_path: Path, data: dict[str, Any]) -> None:
    _timeline_path(project_path).write_text(json.dumps(data, indent=2))


def _snapshotable_model_files(project_path: Path) -> list[Path]:
    files: list[Path] = []
    for f in sorted(project_path.iterdir()):
        if not f.is_file():
            continue
        if f.name.startswith("_active_") or f.name.startswith("_export_"):
            continue
        if f.suffix.lower() not in _SNAPSHOT_SUFFIXES:
            continue
        files.append(f)
    return files


def _snapshot_file_name(index: int, filename: str) -> str:
    return f"{index:04d}__{filename.replace('.', '__')}"


def _snapshot_all_files(project_path: Path, index: int) -> list[dict[str, str]]:
    hist = _history_dir(project_path)
    manifest: list[dict[str, str]] = []
    for src in _snapshotable_model_files(project_path):
        snap_name = _snapshot_file_name(index, src.name)
        shutil.copy2(src, hist / snap_name)
        manifest.append({"filename": src.name, "snapshot": snap_name})
    return manifest


def _delete_entry_snapshots(project_path: Path, entry: dict[str, Any]) -> None:
    hist = _history_dir(project_path)
    seen: set[str] = set()
    for item in entry.get("snapshot_files") or []:
        snap = item.get("snapshot")
        if snap:
            seen.add(snap)
    legacy = entry.get("snapshot")
    if legacy:
        seen.add(legacy)
    for snap in seen:
        snap_path = hist / snap
        if snap_path.is_file():
            snap_path.unlink()


def _remove_model_files_not_in(project_path: Path, keep: set[str]) -> None:
    for src in _snapshotable_model_files(project_path):
        if src.name not in keep:
            src.unlink(missing_ok=True)


def _restore_snapshot_manifest(project_path: Path, manifest: list[dict[str, str]]) -> set[str]:
    keep: set[str] = set()
    for item in manifest:
        filename = item.get("filename")
        snap = item.get("snapshot")
        if not filename or not snap:
            continue
        snap_path = _history_dir(project_path) / snap
        if not snap_path.is_file():
            raise FileNotFoundError(f"Snapshot missing: {snap}")
        shutil.copy2(snap_path, project_path / filename)
        keep.add(filename)
    if keep:
        _remove_model_files_not_in(project_path, keep)
    return keep


def append_entry(
    project_path: Path,
    *,
    kind: str,
    label: str,
    filename: str,
    meta: dict[str, Any] | None = None,
    user_id: str | None = None,
    user_name: str | None = None,
) -> dict[str, Any]:
    """Record a timeline step and snapshot all model files in the project."""
    src = project_path / filename
    if not src.is_file():
        raise FileNotFoundError(f"Cannot snapshot missing file: {filename}")

    data = load_timeline(project_path)
    entries: list[dict[str, Any]] = data.get("entries", [])
    current = data.get("current_index", -1)

    # Truncate redo branch when editing from an earlier step
    if current >= 0 and current < len(entries) - 1:
        for old in entries[current + 1 :]:
            _delete_entry_snapshots(project_path, old)
        entries = entries[: current + 1]

    index = len(entries)
    snapshot_files = _snapshot_all_files(project_path, index)
    primary_snap = next((item["snapshot"] for item in snapshot_files if item["filename"] == filename), None)
    if not primary_snap:
        primary_snap = f"{index:04d}_{src.stem}.glb"
        shutil.copy2(src, _history_dir(project_path) / primary_snap)
        snapshot_files.append({"filename": filename, "snapshot": primary_snap})

    entry = {
        "index": index,
        "id": str(uuid.uuid4())[:8],
        "kind": kind,
        "label": label,
        "filename": filename,
        "snapshot": primary_snap,
        "snapshot_files": snapshot_files,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "meta": meta or {},
        "user_id": user_id,
        "user_name": user_name,
    }
    entries.append(entry)
    data["entries"] = entries
    data["current_index"] = index
    save_timeline(project_path, data)
    return entry


def _files_known_up_to_index(entries: list[dict[str, Any]], index: int) -> set[str]:
    """Best-effort set of model files that existed by a timeline index."""
    known: set[str] = set()
    for i in range(0, min(index, len(entries) - 1) + 1):
        e = entries[i]
        kind = e.get("kind")
        fn = e.get("filename")
        if fn and kind != "delete_object":
            known.add(fn)
        meta = e.get("meta") or {}
        deleted = meta.get("deleted_file")
        if deleted:
            known.discard(deleted)
        for part in meta.get("placed_parts") or []:
            if isinstance(part, dict):
                pf = part.get("filename")
                if pf:
                    known.add(pf)
    return known


def _best_snapshot_for_file(entries: list[dict[str, Any]], index: int, filename: str) -> str | None:
    for i in range(index, -1, -1):
        entry = entries[i]
        for item in entry.get("snapshot_files") or []:
            if item.get("filename") == filename and item.get("snapshot"):
                return item["snapshot"]
        if entry.get("filename") == filename and entry.get("snapshot"):
            return entry["snapshot"]
    return None


def _restore_legacy_assembly_at_index(
    project_path: Path,
    entries: list[dict[str, Any]],
    index: int,
    *,
    primary_filename: str,
) -> str:
    keep = _files_known_up_to_index(entries, index)
    if not keep:
        keep = {primary_filename}
    restored_any = False
    for filename in sorted(keep):
        snap = _best_snapshot_for_file(entries, index, filename)
        if not snap:
            continue
        snap_path = _history_dir(project_path) / snap
        if not snap_path.is_file():
            continue
        shutil.copy2(snap_path, project_path / filename)
        restored_any = True
    if not restored_any:
        snap = _best_snapshot_for_file(entries, index, primary_filename)
        if not snap:
            raise FileNotFoundError(f"Snapshot missing for {primary_filename}")
        snap_path = _history_dir(project_path) / snap
        if not snap_path.is_file():
            raise FileNotFoundError(f"Snapshot missing: {snap}")
        shutil.copy2(snap_path, project_path / primary_filename)
    _remove_model_files_not_in(project_path, keep)
    return primary_filename


def _restore_entry_state(
    project_path: Path,
    entry: dict[str, Any],
    *,
    entries: list[dict[str, Any]] | None = None,
    entry_index: int | None = None,
) -> str:
    """Restore the live project files to a specific timeline entry."""
    kind = entry.get("kind")
    filename = entry.get("filename") or ""
    manifest = entry.get("snapshot_files") or []

    if manifest:
        keep = _restore_snapshot_manifest(project_path, manifest)
        if kind == "delete_object":
            deleted = (entry.get("meta") or {}).get("deleted_file") or filename
            dest = project_path / deleted
            if dest.is_file():
                dest.unlink()
            if deleted in keep:
                keep.discard(deleted)
                _remove_model_files_not_in(project_path, keep)
            return deleted or filename
        return filename

    if kind == "delete_object":
        deleted = (entry.get("meta") or {}).get("deleted_file") or filename
        dest = project_path / deleted
        if dest.is_file():
            dest.unlink()
        return deleted or filename

    if kind == "remove_body":
        meta = entry.get("meta") or {}
        snap_path = _history_dir(project_path) / entry["snapshot"]
        dest = project_path / filename
        if not snap_path.is_file():
            raise FileNotFoundError(f"Snapshot missing: {entry['snapshot']}")
        if meta.get("snapshot_after_op"):
            shutil.copy2(snap_path, dest)
        else:
            mesh = cad_service.load_mesh(snap_path)
            reduced = cad_service.remove_mesh_body(mesh, int(meta.get("body_index", 0)))
            cad_service.export_mesh(reduced, dest)
        if entries is not None and entry_index is not None:
            keep = _files_known_up_to_index(entries, entry_index)
            if keep:
                _remove_model_files_not_in(project_path, keep)
        return filename

    if entries is not None and entry_index is not None:
        return _restore_legacy_assembly_at_index(
            project_path,
            entries,
            entry_index,
            primary_filename=filename,
        )

    snap_path = _history_dir(project_path) / entry.get("snapshot", "")
    if not snap_path.is_file():
        raise FileNotFoundError(f"Snapshot missing: {entry.get('snapshot')}")
    shutil.copy2(snap_path, project_path / filename)
    return filename


def go_to_index(project_path: Path, index: int) -> dict[str, Any]:
    """Restore viewer state to a timeline index (Fusion-style scrub)."""
    data = load_timeline(project_path)
    entries = data.get("entries", [])
    if index < 0 or index >= len(entries):
        raise IndexError(f"Timeline index out of range: {index}")

    current = data.get("current_index", -1)

    # Undo past a delete/remove step — restore removed geometry from snapshots.
    if current > index:
        for i in range(current, index, -1):
            if 0 <= i < len(entries):
                kind = entries[i].get("kind")
                if kind == "delete_object":
                    _restore_snapshot_to_file(project_path, entries[i])
                elif kind == "remove_body" and not (entries[i].get("meta") or {}).get("snapshot_after_op"):
                    _restore_snapshot_to_file(project_path, entries[i])

    entry = entries[index]
    filename = _restore_entry_state(project_path, entry, entries=entries, entry_index=index)

    data["current_index"] = index
    save_timeline(project_path, data)

    restored_filename = None if entry.get("kind") == "delete_object" else filename
    return {
        "index": index,
        "entry": entry,
        "filename": restored_filename,
        "url": f"/api/projects/{project_path.name}/files/{restored_filename}" if restored_filename else None,
    }


def restore_as_latest(
    project_path: Path,
    index: int,
    *,
    user_id: str | None = None,
    user_name: str | None = None,
) -> dict[str, Any]:
    """Restore a timeline snapshot and append that restored state as the newest node."""
    data = load_timeline(project_path)
    entries: list[dict[str, Any]] = data.get("entries", [])
    if index < 0 or index >= len(entries):
        raise IndexError(f"Timeline index out of range: {index}")

    source = entries[index]
    filename = _restore_entry_state(project_path, source, entries=entries, entry_index=index)
    if not filename:
        raise FileNotFoundError("Cannot restore timeline entry without a file target")
    if source.get("kind") != "delete_object" and not (project_path / filename).is_file():
        raise FileNotFoundError("Cannot append a restore node for a state without a live model file")

    # Preserve the whole existing branch. append_entry normally truncates redo
    # history when current_index points at an older node.
    data["current_index"] = len(entries) - 1
    save_timeline(project_path, data)
    restored = append_entry(
        project_path,
        kind="restore",
        label=f"Restored: {source.get('label') or filename}",
        filename=filename,
        meta={
            "restored_from_index": index,
            "restored_from_id": source.get("id"),
            "restored_from_kind": source.get("kind"),
            "restored_from_label": source.get("label"),
        },
        user_id=user_id,
        user_name=user_name,
    )
    return {
        "index": restored["index"],
        "entry": restored,
        "restored_from": _entry_public(source),
        "filename": filename,
        "url": f"/api/projects/{project_path.name}/files/{filename}",
    }


def _delete_entry_snapshot(project_path: Path, entry: dict[str, Any]) -> None:
    _delete_entry_snapshots(project_path, entry)


def remove_entry(project_path: Path, index: int) -> dict[str, Any]:
    """Remove one timeline node and its snapshot, then keep indexes contiguous."""
    data = load_timeline(project_path)
    entries: list[dict[str, Any]] = data.get("entries", [])
    if index < 0 or index >= len(entries):
        raise IndexError(f"Timeline index out of range: {index}")

    old_current = data.get("current_index", len(entries) - 1)
    removed = entries.pop(index)
    _delete_entry_snapshots(project_path, removed)

    for i, entry in enumerate(entries):
        entry["index"] = i

    if not entries:
        new_current = -1
    elif old_current == index:
        new_current = min(index, len(entries) - 1)
    elif old_current > index:
        new_current = old_current - 1
    else:
        new_current = min(old_current, len(entries) - 1)

    data["entries"] = entries
    data["current_index"] = new_current
    save_timeline(project_path, data)

    restored_entry = entries[new_current] if new_current >= 0 else None
    if restored_entry and old_current == index:
        _restore_entry_state(project_path, restored_entry)

    restored_filename = None if restored_entry and restored_entry.get("kind") == "delete_object" else restored_entry.get("filename") if restored_entry else None
    return {
        "removed": _entry_public(removed),
        "current_index": new_current,
        "entry": restored_entry,
        "filename": restored_filename,
        "url": f"/api/projects/{project_path.name}/files/{restored_filename}" if restored_filename else None,
    }


def _restore_snapshot_to_file(project_path: Path, entry: dict[str, Any]) -> None:
    """Copy a timeline snapshot back to the live project file (undo delete)."""
    manifest = entry.get("snapshot_files") or []
    if manifest:
        _restore_snapshot_manifest(project_path, manifest)
        return
    snap_path = _history_dir(project_path) / entry.get("snapshot", "")
    if not snap_path.is_file():
        return
    target = (entry.get("meta") or {}).get("deleted_file") or entry.get("filename")
    if not target:
        return
    shutil.copy2(snap_path, project_path / target)


def _entry_summary(entry: dict[str, Any]) -> str | None:
    kind = entry.get("kind")
    meta = entry.get("meta") or {}
    if kind == "prompt":
        p = meta.get("prompt") or ""
        if not p and entry.get("label", "").startswith("AI: "):
            p = entry["label"][4:].rstrip("…")
        return (p[:160] + "…") if len(p) > 160 else (p or None)
    if kind == "build":
        prog = meta.get("program") or {}
        return prog.get("name") or prog.get("description")
    if kind == "upload":
        return entry.get("filename")
    if kind == "transform":
        return "Move / rotate / scale"
    if kind == "extrude":
        d = meta.get("distance_mm")
        return f"Extrude {d:g} mm" if d is not None else entry.get("label")
    if kind == "delete_object":
        return meta.get("deleted_file") or entry.get("filename")
    if kind == "restore":
        label = meta.get("restored_from_label")
        idx = meta.get("restored_from_index")
        if label:
            return f"Restored from {label}"
        if idx is not None:
            return f"Restored from timeline #{int(idx) + 1}"
    if kind == "remove_body":
        idx = meta.get("body_index")
        if idx is not None:
            return f"Removed body {int(idx) + 1}"
    return None


def _entry_public(e: dict[str, Any]) -> dict[str, Any]:
    return {
        "index": e["index"],
        "id": e["id"],
        "kind": e["kind"],
        "label": e["label"],
        "filename": e["filename"],
        "created_at": e.get("created_at"),
        "user_id": e.get("user_id"),
        "user_name": e.get("user_name"),
        "summary": _entry_summary(e),
    }


def timeline_summary(project_path: Path) -> dict[str, Any]:
    data = load_timeline(project_path)
    return {
        "current_index": data.get("current_index", -1),
        "entries": [_entry_public(e) for e in data.get("entries", [])],
    }


def object_history_list(project_path: Path, *, limit: int = 100) -> list[dict[str, Any]]:
    """Newest-first audit log of model changes (same store as timeline)."""
    data = load_timeline(project_path)
    entries = data.get("entries", [])
    return [_entry_public(e) for e in reversed(entries[-limit:])]
