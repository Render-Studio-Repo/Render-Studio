"""Fusion-style edit timeline: snapshots per step, scrub to restore."""

from __future__ import annotations

import fcntl
import json
import shutil
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Literal

from backend.services import cad_service

_SNAPSHOT_SUFFIXES = {".stl", ".obj", ".glb", ".gltf", ".ply", ".off", ".3mf", ".step", ".stp"}
_MAX_SNAPSHOT_ENTRIES = 8
SnapshotMode = Literal["all", "primary", "none"]


def _timeline_path(project_path: Path) -> Path:
    return project_path / "timeline.json"


def _history_dir(project_path: Path) -> Path:
    d = project_path / "history"
    d.mkdir(parents=True, exist_ok=True)
    return d


@contextmanager
def _timeline_lock(project_path: Path) -> Iterator[None]:
    """Serialize timeline/history writes so concurrent Fusion syncs cannot collide."""
    lock_path = project_path / ".timeline.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("a+", encoding="utf-8") as lock_file:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def load_timeline(project_path: Path) -> dict[str, Any]:
    path = _timeline_path(project_path)
    if not path.is_file():
        return {"current_index": -1, "entries": []}
    return json.loads(path.read_text())


def save_timeline(project_path: Path, data: dict[str, Any]) -> None:
    _timeline_path(project_path).write_text(json.dumps(data, indent=2))


def _next_history_slot(project_path: Path) -> int:
    """Next unused ``NNNN__…`` prefix in the history directory (avoids prune collisions)."""
    hist = _history_dir(project_path)
    max_slot = -1
    for path in hist.iterdir():
        if not path.is_file():
            continue
        name = path.name
        if len(name) < 5 or name[4] not in {"_", "-"}:
            continue
        prefix = name[:4]
        if prefix.isdigit():
            max_slot = max(max_slot, int(prefix))
    return max_slot + 1


def _snapshotable_model_files(project_path: Path) -> list[Path]:
    files: list[Path] = []
    for f in sorted(project_path.iterdir()):
        if not f.is_file():
            continue
        if cad_service.is_internal_model_artifact(f):
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


def prune_snapshot_history(project_path: Path, *, keep: int = _MAX_SNAPSHOT_ENTRIES) -> dict[str, int]:
    """Keep only the newest snapshot entries to prevent model-copy bloat."""
    data = load_timeline(project_path)
    entries: list[dict[str, Any]] = data.get("entries", [])
    keep = max(1, int(keep or 1))
    if len(entries) <= keep:
        return {"removed_entries": 0, "removed_files": 0}

    old_entries = entries[:-keep]
    before_files = set()
    hist = _history_dir(project_path)
    if hist.is_dir():
        before_files = {p.name for p in hist.iterdir() if p.is_file()}
    for old in old_entries:
        _delete_entry_snapshots(project_path, old)
    kept_entries = entries[-keep:]
    # Keep entry.index aligned with list position for timeline scrub APIs.
    # Snapshot filenames stay on their original slot numbers (see _next_history_slot).
    for idx, entry in enumerate(kept_entries):
        entry["index"] = idx
    data["entries"] = kept_entries
    data["current_index"] = len(kept_entries) - 1
    save_timeline(project_path, data)
    after_files = {p.name for p in hist.iterdir() if p.is_file()} if hist.is_dir() else set()
    return {"removed_entries": len(old_entries), "removed_files": len(before_files - after_files)}


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


def _restore_snapshot_file_from_manifest(project_path: Path, manifest: list[dict[str, str]], filename: str) -> bool:
    """Restore one file from a manifest without pruning the rest of the project."""
    if not filename:
        return False
    for item in manifest:
        if item.get("filename") != filename:
            continue
        snap = item.get("snapshot")
        if not snap:
            return False
        snap_path = _history_dir(project_path) / snap
        if not snap_path.is_file():
            raise FileNotFoundError(f"Snapshot missing: {snap}")
        shutil.copy2(snap_path, project_path / filename)
        return True
    return False


def append_entry(
    project_path: Path,
    *,
    kind: str,
    label: str,
    filename: str,
    meta: dict[str, Any] | None = None,
    user_id: str | None = None,
    user_name: str | None = None,
    user_avatar_url: str | None = None,
    snapshot_mode: SnapshotMode = "all",
) -> dict[str, Any]:
    """Record a timeline step and optionally snapshot model files.

    ``snapshot_mode``:
    - ``all``: copy every model file (viewport edits)
    - ``primary``: copy only ``filename`` (Fusion sync / bulk imports)
    - ``none``: metadata-only entry (no history file copies)

    ``entry["index"]`` / ``current_index`` are list positions for the scrub API.
    Snapshot filenames use a separate monotonic history slot so prune cannot
    cause the next write to overwrite a kept entry's files.
    """
    src = project_path / filename
    if snapshot_mode != "none" and not src.is_file():
        raise FileNotFoundError(f"Cannot snapshot missing file: {filename}")

    with _timeline_lock(project_path):
        data = load_timeline(project_path)
        entries: list[dict[str, Any]] = data.get("entries", [])
        current = data.get("current_index", -1)

        # Truncate redo branch when editing from an earlier list position
        if current >= 0 and current < len(entries) - 1:
            for old in entries[current + 1 :]:
                _delete_entry_snapshots(project_path, old)
            entries = entries[: current + 1]

        list_index = len(entries)
        history_slot = _next_history_slot(project_path)
        snapshot_files: list[dict[str, str]] = []
        primary_snap: str | None = None
        if snapshot_mode == "all":
            snapshot_files = _snapshot_all_files(project_path, history_slot)
            primary_snap = next((item["snapshot"] for item in snapshot_files if item["filename"] == filename), None)
        elif snapshot_mode == "primary":
            primary_snap = _snapshot_file_name(history_slot, filename)
            shutil.copy2(src, _history_dir(project_path) / primary_snap)
            snapshot_files = [{"filename": filename, "snapshot": primary_snap}]

        if snapshot_mode != "none" and not primary_snap:
            primary_snap = f"{history_slot:04d}_{src.stem}{src.suffix.lower() or '.glb'}"
            shutil.copy2(src, _history_dir(project_path) / primary_snap)
            snapshot_files.append({"filename": filename, "snapshot": primary_snap})

        entry = {
            "index": list_index,
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
            "user_avatar_url": user_avatar_url,
        }
        entries.append(entry)
        data["entries"] = entries
        data["current_index"] = list_index
        save_timeline(project_path, data)
        prune_snapshot_history(project_path)
        # After prune, return the (possibly reindexed) public entry from disk.
        refreshed = load_timeline(project_path)
        refreshed_entries = refreshed.get("entries") or []
        return refreshed_entries[-1] if refreshed_entries else entry


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
        if kind in {"transform", "body_transform"} and filename:
            if _restore_snapshot_file_from_manifest(project_path, manifest, filename):
                return filename
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
    if kind in {"prompt", "render", "scene_render"}:
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
    meta = e.get("meta") or {}
    return {
        "index": e["index"],
        "id": e["id"],
        "kind": e["kind"],
        "label": e["label"],
        "filename": e["filename"],
        "created_at": e.get("created_at"),
        "user_id": e.get("user_id"),
        "user_name": e.get("user_name"),
        "user_avatar_url": e.get("user_avatar_url"),
        "summary": _entry_summary(e),
        "meta": meta,
        "prompt_mode": e.get("prompt_mode") or meta.get("prompt_mode"),
        "cost_usd": e.get("cost_usd") if e.get("cost_usd") is not None else meta.get("cost_usd"),
        "usage": e.get("usage") or meta.get("usage"),
        "model": e.get("model") or meta.get("model"),
        "provider": e.get("provider") or meta.get("provider"),
        "restorable": bool(e.get("snapshot") or e.get("snapshot_files")),
    }


def _prompt_history_text_key(entry: dict[str, Any]) -> str | None:
    prompt = " ".join(str(entry.get("prompt") or entry.get("original_prompt") or "").split()).strip().lower()
    if not prompt:
        return None
    filename = Path(str(entry.get("filename") or entry.get("base_filename") or "")).stem.lstrip(".").lower()
    return f"{filename}:{prompt[:160]}"


def _timeline_text_key(entry: dict[str, Any]) -> str | None:
    meta = entry.get("meta") or {}
    prompt = " ".join(str(meta.get("prompt") or entry.get("summary") or entry.get("label") or "").split()).strip().lower()
    for prefix in ("ai: ", "render: ", "edit: "):
        if prompt.startswith(prefix):
            prompt = prompt[len(prefix):].strip()
            break
    if not prompt:
        return None
    filename = Path(str(entry.get("filename") or meta.get("base_filename") or "")).stem.lstrip(".").lower()
    return f"{filename}:{prompt[:160]}"


def _prompt_history_timeline_meta(entry: dict[str, Any]) -> dict[str, Any]:
    meta = {
        "prompt": entry.get("prompt") or entry.get("original_prompt"),
        "prompt_id": entry.get("id"),
        "prompt_mode": entry.get("prompt_mode") or ("render" if (entry.get("kind") or "") == "render" else "standard"),
        "speed": entry.get("speed"),
        "success": entry.get("success"),
        "model": entry.get("model"),
        "provider": entry.get("provider"),
        "trace_id": entry.get("trace_id"),
        "base_filename": entry.get("base_filename"),
        "source": "prompt_history",
    }
    for key in ("usage", "cost_usd", "ai_calls"):
        if entry.get(key) is not None:
            meta[key] = entry.get(key)
    return {k: v for k, v in meta.items() if v is not None}


def _sync_prompt_history_into_timeline(project_path: Path) -> None:
    """Backfill AI prompt/render rows into the scrubber timeline and enrich costs."""
    try:
        from backend.services import prompt_history_service
    except Exception:
        return

    data = load_timeline(project_path)
    entries: list[dict[str, Any]] = data.get("entries", [])
    original_entry_count = len(entries)
    current_index = data.get("current_index", -1)
    current_id = None
    if 0 <= int(current_index or -1) < len(entries):
        current_id = entries[int(current_index)].get("id")

    try:
        prompt_entries = list(reversed(prompt_history_service.list_entries(project_path, limit=300)))
    except Exception:
        return

    by_trace = {
        str((e.get("meta") or {}).get("trace_id")): e
        for e in entries
        if (e.get("meta") or {}).get("trace_id")
    }
    by_prompt_id = {
        str((e.get("meta") or {}).get("prompt_id")): e
        for e in entries
        if (e.get("meta") or {}).get("prompt_id")
    }
    by_text = {key: e for e in entries if (key := _timeline_text_key(e))}
    changed = False
    appended = False

    for pe in prompt_entries:
        prompt_text = str(pe.get("prompt") or pe.get("original_prompt") or "").strip()
        if not prompt_text:
            continue
        meta = _prompt_history_timeline_meta(pe)
        trace_id = str(pe.get("trace_id") or "")
        prompt_id = str(pe.get("id") or "")
        target = by_trace.get(trace_id) if trace_id else None
        if target is None and prompt_id:
            target = by_prompt_id.get(prompt_id)
        if target is None:
            text_key = _prompt_history_text_key(pe)
            target = by_text.get(text_key) if text_key else None

        if target is not None:
            target_meta = target.setdefault("meta", {})
            for key, value in meta.items():
                if value is not None and target_meta.get(key) != value:
                    target_meta[key] = value
                    changed = True
            continue

        history_kind = str(pe.get("kind") or "cad").lower()
        prompt_mode = str(pe.get("prompt_mode") or "").lower()
        timeline_kind = "render" if history_kind == "render" or prompt_mode == "render" else "prompt"
        prefix = "Render" if timeline_kind == "render" else "AI"
        label_src = prompt_text[:48] + ("…" if len(prompt_text) > 48 else "")
        item = {
            "index": len(entries),
            "id": prompt_id or str(uuid.uuid4())[:10],
            "kind": timeline_kind,
            "label": f"{prefix}: {label_src}",
            "filename": pe.get("base_filename") or pe.get("filename") or "",
            "snapshot": None,
            "snapshot_files": [],
            "created_at": pe.get("created_at") or datetime.now(timezone.utc).isoformat(),
            "meta": meta,
            "user_id": pe.get("user_id"),
            "user_name": pe.get("user_name"),
            "user_avatar_url": pe.get("user_avatar_url"),
        }
        entries.append(item)
        appended = True
        changed = True
        if trace_id:
            by_trace[trace_id] = item
        if prompt_id:
            by_prompt_id[prompt_id] = item
        text_key = _prompt_history_text_key(pe)
        if text_key:
            by_text[text_key] = item

    if not changed:
        return

    was_at_end = current_index is not None and int(current_index or -1) >= original_entry_count - 1
    entries.sort(key=lambda e: str(e.get("created_at") or ""))
    for idx, entry in enumerate(entries):
        entry["index"] = idx
    data["entries"] = entries
    if appended and was_at_end:
        data["current_index"] = len(entries) - 1
    elif current_id:
        data["current_index"] = next((i for i, e in enumerate(entries) if e.get("id") == current_id), len(entries) - 1)
    else:
        data["current_index"] = min(max(int(current_index or -1), -1), len(entries) - 1)
    save_timeline(project_path, data)


def timeline_summary(project_path: Path) -> dict[str, Any]:
    _sync_prompt_history_into_timeline(project_path)
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
