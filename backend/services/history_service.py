"""Fusion-style edit timeline: snapshots per step, scrub to restore."""

from __future__ import annotations

import fcntl
import filecmp
import json
import logging
import os
import shutil
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Literal

from backend.services import cad_service
from backend.services import drive_model_snapshot_service

logger = logging.getLogger(__name__)

_SNAPSHOT_SUFFIXES = {".stl", ".obj", ".glb", ".gltf", ".ply", ".off", ".step", ".stp", ".3mf"}
_MAX_SNAPSHOT_ENTRIES = 40
_MIN_HEALTHY_BYTES = 32
SnapshotMode = Literal["all", "primary", "none"]


def _timeline_path(project_path: Path) -> Path:
    return project_path / "timeline.json"


def _history_dir(project_path: Path, *, create: bool = False) -> Path:
    d = project_path / "history"
    if create:
        d.mkdir(parents=True, exist_ok=True)
    return d


def _live_file_healthy(path: Path | None) -> bool:
    if path is None or not path.is_file():
        return False
    if path.suffix.lower() in {".glb", ".gltf"}:
        return _usable_restore_file(path)
    try:
        return path.stat().st_size >= _MIN_HEALTHY_BYTES
    except OSError:
        return False


def _usable_restore_file(path: Path | None, expected_bytes: int | None = None) -> bool:
    """True when ``path`` is a real model, not a Drive-id JSON stub."""
    if path is None or not path.is_file():
        return False
    try:
        size = path.stat().st_size
    except OSError:
        return False
    if size < _MIN_HEALTHY_BYTES:
        return False
    suffix = path.suffix.lower()
    if suffix in _SNAPSHOT_SUFFIXES:
        try:
            head = path.read_bytes()[:8]
        except OSError:
            return False
        if head[:1] == b"{":
            return False
        if suffix == ".glb" and not head.startswith(b"glTF"):
            return False
    if expected_bytes is not None:
        try:
            return size == int(expected_bytes)
        except (TypeError, ValueError):
            return False
    return True


def _expected_item_bytes(item: dict[str, Any] | None) -> int | None:
    if not item:
        return None
    raw = item.get("bytes")
    if raw is None:
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _restore_dest_for_item(
    project_path: Path,
    filename: str | None,
    item: dict[str, Any] | None = None,
    *,
    preferred_filename: str | None = None,
) -> Path:
    """Prefer the engine-folder live path over a basename dumped at project root."""
    from backend.services.engine_layout import ENGINE_FOLDER_SET, normalize_rel

    expected = _expected_item_bytes(item)
    names: list[str] = []
    for name in (preferred_filename, filename):
        if name and name not in names:
            names.append(str(name))

    def _cleaned(name: str) -> str:
        return normalize_rel(name) or Path(str(name or "")).name

    for name in names:
        dest = Path(project_path) / _cleaned(name)
        if dest.is_file() and (_usable_restore_file(dest, expected) or _usable_restore_file(dest)):
            return dest

    base = Path(str(filename or preferred_filename or "")).name
    if base:
        for folder in ENGINE_FOLDER_SET:
            dest = Path(project_path) / folder / base
            if dest.is_file() and (_usable_restore_file(dest, expected) or _usable_restore_file(dest)):
                return dest

    chosen = preferred_filename or filename or base
    return Path(project_path) / _cleaned(str(chosen))


def _local_restore_candidate(
    project_path: Path,
    dest: Path,
    filename: str | None,
    item: dict[str, Any] | None,
) -> Path | None:
    from backend.services.engine_layout import ENGINE_FOLDER_SET, normalize_rel

    expected = _expected_item_bytes(item)
    seen: set[Path] = set()
    candidates: list[Path] = [dest]
    if filename:
        cleaned = normalize_rel(filename) or Path(str(filename)).name
        candidates.append(Path(project_path) / cleaned)
    base = Path(str(filename or dest.name)).name
    if base:
        candidates.append(Path(project_path) / base)
        for folder in ENGINE_FOLDER_SET:
            candidates.append(Path(project_path) / folder / base)

    exact: Path | None = None
    usable: Path | None = None
    for cand in candidates:
        try:
            resolved = cand.resolve()
        except OSError:
            continue
        if resolved in seen:
            continue
        seen.add(resolved)
        if expected is not None and _usable_restore_file(cand, expected):
            exact = cand
            break
        if usable is None and _usable_restore_file(cand):
            usable = cand
    return exact or usable


def _latest_name_for(filename: str) -> str:
    return "latest__" + str(filename or "").replace("\\", "/").replace("/", "__").replace(".", "__")


def _record_drive_latest(data: dict[str, Any], filename: str, item: dict[str, Any]) -> None:
    latest = data.setdefault("drive_latest", {})
    if not isinstance(latest, dict):
        latest = {}
        data["drive_latest"] = latest
    file_id = item.get("drive_latest_id") or item.get("drive_file_id")
    if not filename or not file_id:
        return
    latest[filename] = {
        "drive_file_id": file_id,
        "drive_version_id": item.get("drive_file_id") or file_id,
        "snapshot": item.get("snapshot"),
        "bytes": item.get("bytes"),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


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
    try:
        raw = path.read_text()
        if not raw.strip():
            return {"current_index": -1, "entries": []}
        data = json.loads(raw)
        if not isinstance(data, dict):
            return {"current_index": -1, "entries": []}
        return data
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("Ignoring unreadable timeline %s: %s", path, exc)
        return {"current_index": -1, "entries": []}


def save_timeline(project_path: Path, data: dict[str, Any]) -> None:
    _timeline_path(project_path).write_text(json.dumps(data, indent=2))


def _next_history_slot(project_path: Path, entries: list[dict[str, Any]] | None = None) -> int:
    """Next unused ``NNNN__…`` prefix (timeline + leftover local history files)."""
    max_slot = -1

    def _consider(name: str) -> None:
        nonlocal max_slot
        if len(name) < 5 or name[4] not in {"_", "-"}:
            return
        prefix = name[:4]
        if prefix.isdigit():
            max_slot = max(max_slot, int(prefix))

    hist = _history_dir(project_path)
    if hist.is_dir():
        for path in hist.iterdir():
            if path.is_file():
                _consider(path.name)
    for entry in entries or []:
        for item in entry.get("snapshot_files") or []:
            snap = str(item.get("snapshot") or "")
            if snap:
                _consider(snap)
        snap = str(entry.get("snapshot") or "")
        if snap:
            _consider(snap)
    return max_slot + 1


def _is_history_derived_artifact(path: Path | str) -> bool:
    """Print/view sidecars that undo can leave on disk; do not snapshot them.

    Exploded GLB/STEP and generation-live previews are regenerable views.
    Share/export/active copies are not model history. 3MF *is* a model backup
    and is snapshotted to Google Drive (never as a local history duplicate).
    """
    p = Path(path)
    name = p.name
    lower = name.lower()
    if name.startswith("."):
        return True
    if name.startswith("_share_") or name.startswith("_export_") or name.startswith("_active_"):
        return True
    if ".generation-live." in lower:
        return True
    if p.stem.lower().endswith("_exploded"):
        return True
    return False


def _snapshotable_model_files(project_path: Path) -> list[Path]:
    files: list[Path] = []
    for f in sorted(project_path.iterdir()):
        if not f.is_file():
            continue
        if cad_service.is_internal_model_artifact(f):
            continue
        if _is_history_derived_artifact(f):
            continue
        if f.suffix.lower() not in _SNAPSHOT_SUFFIXES:
            continue
        files.append(f)
    return files


def _snapshot_file_name(index: int, filename: str) -> str:
    # Engine-folder paths like mesh/hero.glb must not create nested files under history/.
    flat = str(filename or "").replace("\\", "/").replace("/", "__").replace(".", "__")
    return f"{index:04d}__{flat}"


def _copy_snapshot_to_project(project_path: Path, filename: str, snap_path: Path) -> Path:
    """Write a history snapshot to a project-relative path, creating engine folders."""
    from backend.services.engine_layout import normalize_rel

    cleaned = normalize_rel(filename) or Path(str(filename or "")).name
    dest = Path(project_path) / cleaned
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(snap_path, dest)
    return dest


def _item_drive_id(item: dict[str, Any] | None) -> str | None:
    if not item:
        return None
    for key in ("drive_file_id", "drive_latest_id"):
        val = item.get(key)
        if val:
            return str(val)
    return None


def _lookup_drive_id(
    project_path: Path,
    filename: str,
    *,
    snapshot: str | None = None,
    item: dict[str, Any] | None = None,
) -> str | None:
    fid = _item_drive_id(item)
    if fid:
        return fid
    data = load_timeline(project_path)
    if snapshot:
        for entry in reversed(data.get("entries") or []):
            if entry.get("snapshot") == snapshot and entry.get("drive_file_id"):
                return str(entry["drive_file_id"])
            for row in entry.get("snapshot_files") or []:
                if row.get("snapshot") == snapshot and row.get("drive_file_id"):
                    return str(row["drive_file_id"])
    latest = (data.get("drive_latest") or {}).get(filename) or {}
    if isinstance(latest, dict) and latest.get("drive_file_id"):
        return str(latest["drive_file_id"])
    for entry in reversed(data.get("entries") or []):
        for row in entry.get("snapshot_files") or []:
            if row.get("filename") == filename and row.get("drive_file_id"):
                return str(row["drive_file_id"])
        if entry.get("filename") == filename and entry.get("drive_file_id"):
            return str(entry["drive_file_id"])
    return None


def _materialize_snapshot_to(
    project_path: Path,
    dest: Path,
    *,
    snap_name: str | None = None,
    drive_file_id: str | None = None,
    filename: str | None = None,
    item: dict[str, Any] | None = None,
) -> Path:
    """Copy a snapshot onto ``dest`` from leftover local history or Google Drive."""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if snap_name:
        local = _history_dir(project_path) / snap_name
        if local.is_file() and local.stat().st_size >= _MIN_HEALTHY_BYTES:
            if local.resolve() != dest.resolve():
                shutil.copy2(local, dest)
            return dest
    local_live = _local_restore_candidate(project_path, dest, filename, item)
    own_drive_id = drive_file_id or _item_drive_id(item)
    if local_live and _usable_restore_file(local_live):
        dest_usable = _usable_restore_file(dest)
        same = False
        try:
            same = local_live.resolve() == dest.resolve()
        except OSError:
            same = local_live == dest
        if same:
            return dest
        if dest_usable and not own_drive_id:
            return dest
        if not dest_usable:
            try:
                dest.unlink()
            except OSError:
                pass
            shutil.copy2(local_live, dest)
            return dest
        if not own_drive_id:
            return local_live
    file_id = own_drive_id or _lookup_drive_id(
        project_path, filename or dest.name, snapshot=snap_name, item=item
    )
    if file_id:
        try:
            drive_model_snapshot_service.download_file(file_id, dest)
        except Exception as exc:
            if local_live and _usable_restore_file(local_live):
                logger.warning(
                    "Drive restore failed for %s/%s (%s); using local %s",
                    project_path.name,
                    filename or dest.name,
                    exc,
                    local_live,
                )
                if local_live.resolve() != dest.resolve() and not _usable_restore_file(dest):
                    shutil.copy2(local_live, dest)
                    return dest
                return local_live
            raise FileNotFoundError(
                f"Snapshot missing: {snap_name or filename or dest.name} ({exc})"
            ) from exc
        if not _usable_restore_file(dest):
            logger.error(
                "Drive restore wrote a non-model file project=%s file=%s drive_id=%s dest=%s",
                project_path.name,
                filename or dest.name,
                file_id,
                dest,
            )
            try:
                dest.unlink()
            except OSError:
                pass
            if local_live and _usable_restore_file(local_live):
                shutil.copy2(local_live, dest)
                return dest
            raise FileNotFoundError(
                f"Snapshot is not a usable model: {snap_name or filename or dest.name}"
            )
        logger.info(
            "Restored model from Google Drive project=%s file=%s drive_id=%s dest=%s",
            project_path.name,
            filename or dest.name,
            file_id,
            dest,
        )
        return dest
    if local_live and _usable_restore_file(local_live):
        if local_live.resolve() != dest.resolve() and not _usable_restore_file(dest):
            shutil.copy2(local_live, dest)
            return dest
        return local_live
    raise FileNotFoundError(f"Snapshot missing: {snap_name or filename or dest.name}")


def _previous_snapshot_item(
    filename: str,
    entries: list[dict[str, Any]],
) -> dict[str, Any] | None:
    for entry in reversed(entries):
        for item in entry.get("snapshot_files") or []:
            if item.get("filename") == filename and (item.get("snapshot") or item.get("drive_file_id")):
                return item
        if entry.get("filename") == filename and (entry.get("snapshot") or entry.get("drive_file_id")):
            return {
                "filename": filename,
                "snapshot": entry.get("snapshot"),
                "drive_file_id": entry.get("drive_file_id"),
                "drive_latest_id": entry.get("drive_latest_id"),
                "bytes": entry.get("bytes"),
                "mtime_ns": entry.get("mtime_ns"),
            }
    return None


def _previous_snapshot_path(
    project_path: Path,
    filename: str,
    entries: list[dict[str, Any]],
) -> Path | None:
    hist = _history_dir(project_path)
    if not hist.is_dir():
        return None
    for entry in reversed(entries):
        for item in entry.get("snapshot_files") or []:
            if item.get("filename") != filename:
                continue
            snap = item.get("snapshot")
            if not snap:
                continue
            path = hist / snap
            if path.is_file():
                return path
        if entry.get("filename") == filename and entry.get("snapshot"):
            path = hist / str(entry["snapshot"])
            if path.is_file():
                return path
    return None


def _file_fingerprint(path: Path) -> dict[str, int]:
    st = path.stat()
    return {"bytes": int(st.st_size), "mtime_ns": int(st.st_mtime_ns)}


def _fingerprints_match(item: dict[str, Any] | None, src: Path) -> bool:
    if not item:
        return False
    try:
        fp = _file_fingerprint(src)
    except OSError:
        return False
    return item.get("bytes") == fp["bytes"] and item.get("mtime_ns") == fp["mtime_ns"]


def _upload_snapshot_item(
    project_path: Path,
    src: Path,
    snap_name: str,
    previous: dict[str, Any] | None,
) -> dict[str, Any]:
    """Snapshot ``src`` to Google Drive. Never copies the CAD blob into history/."""
    fp = _file_fingerprint(src)
    item: dict[str, Any] = {
        "filename": src.name,
        "snapshot": snap_name,
        "bytes": fp["bytes"],
        "mtime_ns": fp["mtime_ns"],
    }
    if previous and _fingerprints_match(previous, src) and previous.get("drive_file_id"):
        item["drive_file_id"] = previous["drive_file_id"]
        item["drive_latest_id"] = previous.get("drive_latest_id") or previous.get("drive_file_id")
        logger.debug("Reusing Drive snapshot for unchanged %s (%s)", src.name, item["drive_file_id"])
        return item

    latest_name = _latest_name_for(src.name)
    latest_id = (previous or {}).get("drive_latest_id")
    if drive_model_snapshot_service.drive_available():
        try:
            version_id = drive_model_snapshot_service.upload_file(
                project_path.name, src, snap_name
            )
            item["drive_file_id"] = version_id
            try:
                latest_id = drive_model_snapshot_service.upload_file(
                    project_path.name, src, latest_name, existing_id=latest_id
                )
            except Exception as exc:
                logger.warning("Drive latest-pointer upload failed for %s: %s", src.name, exc)
                latest_id = version_id
            item["drive_latest_id"] = latest_id
            return item
        except Exception as exc:
            logger.error(
                "Drive model snapshot failed for %s/%s — not writing a local history copy: %s",
                project_path.name,
                src.name,
                exc,
            )
            item["drive_error"] = str(exc)
            return item

    logger.warning(
        "Google Drive not available; skipping local history blob for %s/%s (%s bytes)",
        project_path.name,
        src.name,
        fp["bytes"],
    )
    item["drive_error"] = drive_model_snapshot_service.drive_unavailable_reason() or "drive unavailable"
    return item


def _link_or_copy_snapshot(src: Path, dest: Path, previous: Path | None) -> None:
    """Legacy local copy path — unused for new snapshots (Drive-only)."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    if previous and previous.is_file() and previous.resolve() != dest.resolve():
        try:
            if previous.stat().st_size == src.stat().st_size and filecmp.cmp(
                previous, src, shallow=True
            ):
                if dest.exists():
                    dest.unlink()
                os.link(previous, dest)
                return
        except OSError:
            pass
    shutil.copy2(src, dest)


def _snapshot_all_files(
    project_path: Path,
    index: int,
    previous_entries: list[dict[str, Any]] | None = None,
    timeline_data: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    prior = previous_entries or []
    manifest: list[dict[str, Any]] = []
    for src in _snapshotable_model_files(project_path):
        snap_name = _snapshot_file_name(index, src.name)
        prev = _previous_snapshot_item(src.name, prior)
        item = _upload_snapshot_item(project_path, src, snap_name, prev)
        if timeline_data is not None:
            _record_drive_latest(timeline_data, src.name, item)
        manifest.append(item)
    return manifest


def hardlink_identical_snapshots(project_path: Path) -> dict[str, int]:
    """Share inodes for byte-identical history copies. Safe: no unique files deleted."""
    data = load_timeline(project_path)
    hist = _history_dir(project_path)
    by_name: dict[str, list[Path]] = {}
    for entry in data.get("entries") or []:
        for item in entry.get("snapshot_files") or []:
            filename = item.get("filename")
            snap = item.get("snapshot")
            if not filename or not snap:
                continue
            path = hist / snap
            if path.is_file():
                by_name.setdefault(filename, []).append(path)
    linked = 0
    skipped = 0
    for paths in by_name.values():
        unique: list[Path] = []
        seen: set[int] = set()
        for path in paths:
            try:
                ino = path.stat().st_ino
            except OSError:
                continue
            if ino in seen:
                continue
            seen.add(ino)
            unique.append(path)
        if len(unique) < 2:
            continue
        canonical = unique[-1]
        for older in unique[:-1]:
            try:
                if older.stat().st_size != canonical.stat().st_size:
                    skipped += 1
                    continue
                if not filecmp.cmp(older, canonical, shallow=False):
                    skipped += 1
                    continue
                older.unlink()
                os.link(canonical, older)
                linked += 1
            except OSError:
                skipped += 1
    return {"linked": linked, "skipped": skipped}


def _delete_entry_snapshots(project_path: Path, entry: dict[str, Any]) -> None:
    hist = _history_dir(project_path)
    seen: set[str] = set()
    drive_ids: set[str] = set()
    latest_ids: set[str] = set()
    data = load_timeline(project_path)
    for _fn, meta in (data.get("drive_latest") or {}).items():
        if isinstance(meta, dict) and meta.get("drive_file_id"):
            latest_ids.add(str(meta["drive_file_id"]))
        if isinstance(meta, dict) and meta.get("drive_version_id"):
            latest_ids.add(str(meta["drive_version_id"]))
    for item in entry.get("snapshot_files") or []:
        snap = item.get("snapshot")
        if snap:
            seen.add(snap)
        fid = item.get("drive_file_id")
        latest = item.get("drive_latest_id")
        if fid:
            drive_ids.add(str(fid))
        if latest:
            latest_ids.add(str(latest))
    legacy = entry.get("snapshot")
    if legacy:
        seen.add(legacy)
    if hist.is_dir():
        for snap in seen:
            snap_path = hist / snap
            if snap_path.is_file():
                snap_path.unlink()
    for fid in drive_ids:
        if fid in latest_ids:
            continue
        try:
            drive_model_snapshot_service.delete_file(fid)
        except Exception:
            logger.debug("Drive prune skipped for %s", fid, exc_info=True)


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
    else:
        hist = None
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
    after_files = {p.name for p in hist.iterdir() if p.is_file()} if hist is not None and hist.is_dir() else set()
    return {"removed_entries": len(old_entries), "removed_files": len(before_files - after_files)}


def _remove_model_files_not_in(project_path: Path, keep: set[str]) -> None:
    for src in _snapshotable_model_files(project_path):
        if src.name not in keep:
            src.unlink(missing_ok=True)


def _restore_snapshot_manifest(
    project_path: Path,
    manifest: list[dict[str, str]],
    *,
    preferred_filename: str | None = None,
) -> set[str]:
    keep: set[str] = set()
    for item in manifest:
        filename = item.get("filename")
        snap = item.get("snapshot")
        if not filename or not (snap or _item_drive_id(item) or preferred_filename):
            continue
        dest = _restore_dest_for_item(
            project_path,
            filename,
            item,
            preferred_filename=preferred_filename,
        )
        _materialize_snapshot_to(
            project_path,
            dest,
            snap_name=snap,
            item=item,
            filename=filename,
        )
        keep.add(filename)
        keep.add(dest.name)
        root_dup = Path(project_path) / Path(str(filename)).name
        try:
            if (
                root_dup.is_file()
                and root_dup.resolve() != dest.resolve()
                and not _usable_restore_file(root_dup)
            ):
                root_dup.unlink()
        except OSError:
            pass
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
        if not snap and not _item_drive_id(item):
            return False
        dest = _restore_dest_for_item(project_path, filename, item)
        _materialize_snapshot_to(
            project_path,
            dest,
            snap_name=snap,
            item=item,
            filename=filename,
        )
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
    from backend.services.engine_layout import resolve_in_layout

    src = resolve_in_layout(project_path, filename)
    if src is None:
        src = Path(project_path) / str(filename or "")
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
        history_slot = _next_history_slot(project_path, entries)
        snapshot_files: list[dict[str, Any]] = []
        primary_snap: str | None = None
        primary_item: dict[str, Any] | None = None
        if snapshot_mode == "all":
            snapshot_files = _snapshot_all_files(project_path, history_slot, entries, data)
            primary_item = next((item for item in snapshot_files if item.get("filename") == filename), None)
            primary_snap = (primary_item or {}).get("snapshot")
        elif snapshot_mode == "primary":
            primary_snap = _snapshot_file_name(history_slot, filename)
            primary_item = _upload_snapshot_item(
                project_path, src, primary_snap, _previous_snapshot_item(filename, entries)
            )
            snapshot_files = [primary_item]
            _record_drive_latest(data, filename, primary_item)

        if snapshot_mode != "none" and not primary_snap:
            primary_snap = f"{history_slot:04d}_{src.stem}{src.suffix.lower() or '.glb'}"
            primary_item = _upload_snapshot_item(
                project_path, src, primary_snap, _previous_snapshot_item(filename, entries)
            )
            snapshot_files.append(primary_item)
            _record_drive_latest(data, filename, primary_item)

        entry = {
            "index": list_index,
            "id": str(uuid.uuid4())[:8],
            "kind": kind,
            "label": label,
            "filename": filename,
            "snapshot": primary_snap,
            "drive_file_id": (primary_item or {}).get("drive_file_id"),
            "drive_latest_id": (primary_item or {}).get("drive_latest_id"),
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
        try:
            hardlink_identical_snapshots(project_path)
        except OSError:
            logger.debug("history hardlink dedupe skipped for %s", project_path.name, exc_info=True)
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


def _best_snapshot_item(entries: list[dict[str, Any]], index: int, filename: str) -> dict[str, Any] | None:
    for i in range(index, -1, -1):
        entry = entries[i]
        for item in entry.get("snapshot_files") or []:
            if item.get("filename") == filename and (item.get("snapshot") or _item_drive_id(item)):
                return item
        if entry.get("filename") == filename and (entry.get("snapshot") or entry.get("drive_file_id")):
            return {
                "filename": filename,
                "snapshot": entry.get("snapshot"),
                "drive_file_id": entry.get("drive_file_id"),
                "drive_latest_id": entry.get("drive_latest_id"),
            }
    return None


def _best_snapshot_for_file(entries: list[dict[str, Any]], index: int, filename: str) -> str | None:
    item = _best_snapshot_item(entries, index, filename)
    return str(item["snapshot"]) if item and item.get("snapshot") else None


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
        item = _best_snapshot_item(entries, index, filename)
        if not item:
            continue
        from backend.services.engine_layout import normalize_rel

        cleaned = normalize_rel(filename) or Path(str(filename or "")).name
        dest = Path(project_path) / cleaned
        try:
            _materialize_snapshot_to(
                project_path,
                dest,
                snap_name=item.get("snapshot"),
                item=item,
                filename=filename,
            )
        except FileNotFoundError:
            continue
        restored_any = True
    if not restored_any:
        item = _best_snapshot_item(entries, index, primary_filename)
        if not item:
            raise FileNotFoundError(f"Snapshot missing for {primary_filename}")
        from backend.services.engine_layout import normalize_rel

        cleaned = normalize_rel(primary_filename) or Path(str(primary_filename or "")).name
        dest = Path(project_path) / cleaned
        _materialize_snapshot_to(
            project_path,
            dest,
            snap_name=item.get("snapshot"),
            item=item,
            filename=primary_filename,
        )
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
        keep = _restore_snapshot_manifest(
            project_path,
            manifest,
            preferred_filename=filename or None,
        )
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

    if not (manifest or entry.get("snapshot") or entry.get("drive_file_id")) and not filename and kind not in {"delete_object"}:
        raise FileNotFoundError("This timeline step has no model snapshot to restore")

    if kind == "remove_body":
        meta = entry.get("meta") or {}
        dest = Path(project_path) / filename
        dest.parent.mkdir(parents=True, exist_ok=True)
        _materialize_snapshot_to(
            project_path,
            dest,
            snap_name=entry.get("snapshot"),
            drive_file_id=entry.get("drive_file_id"),
            filename=filename,
            item=entry,
        )
        if not meta.get("snapshot_after_op"):
            mesh = cad_service.load_mesh(dest)
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

    dest_name = filename
    from backend.services.engine_layout import normalize_rel

    cleaned = normalize_rel(dest_name) or Path(str(dest_name or "")).name
    dest = Path(project_path) / cleaned
    _materialize_snapshot_to(
        project_path,
        dest,
        snap_name=entry.get("snapshot"),
        drive_file_id=entry.get("drive_file_id"),
        filename=filename,
        item=entry,
    )
    return filename


def go_to_index(project_path: Path, index: int) -> dict[str, Any]:
    """Restore viewer state to a timeline index (Fusion-style scrub)."""
    data = load_timeline(project_path)
    entries = data.get("entries", [])
    if index < 0 or index >= len(entries):
        raise IndexError(f"Timeline index out of range: {index}")

    current = data.get("current_index", -1)

    # LOCKED INVARIANT (Cmd+Z move undo): surgical single-step undo of a transform.
    # Restore only the moved file(s). Full manifest restore of the previous entry
    # can delete sibling assembly parts. Do not remove this branch — see
    # `.cursor/rules/cmdz-transform-undo.mdc` and `frontend/viewport/viewport-transform-undo.js`.
    if current == index + 1 and 0 <= current < len(entries):
        cur_entry = entries[current]
        if cur_entry.get("kind") in {"transform", "body_transform"}:
            filename = _surgical_undo_transform(project_path, cur_entry, entries, index)
            data["current_index"] = index
            save_timeline(project_path, data)
            return {
                "index": index,
                "entry": entries[index],
                "filename": filename,
                "url": f"/api/projects/{project_path.name}/files/{filename}" if filename else None,
            }

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


def _surgical_undo_transform(
    project_path: Path,
    transform_entry: dict[str, Any],
    entries: list[dict[str, Any]],
    prev_index: int,
) -> str:
    """LOCKED: Undo one transform without wiping unrelated assembly files.

    Do not replace this with a full timeline snapshot restore — that deletes
    sibling parts. See `.cursor/rules/cmdz-transform-undo.mdc`.
    """
    meta = transform_entry.get("meta") or {}
    current_fn = str(transform_entry.get("filename") or "")
    parent_fn = str(meta.get("parent") or current_fn or "")
    prev_entry = entries[prev_index] if 0 <= prev_index < len(entries) else {}
    prev_names = {
        str(item.get("filename"))
        for item in (prev_entry.get("snapshot_files") or [])
        if item.get("filename")
    }
    if prev_entry.get("filename"):
        prev_names.add(str(prev_entry["filename"]))

    restored = ""
    for fn in dict.fromkeys([parent_fn, current_fn]):
        if not fn:
            continue
        item = _best_snapshot_item(entries, prev_index, fn)
        if not item:
            continue
        from backend.services.engine_layout import normalize_rel

        cleaned = normalize_rel(fn) or Path(str(fn)).name
        dest = Path(project_path) / cleaned
        try:
            _materialize_snapshot_to(
                project_path,
                dest,
                snap_name=item.get("snapshot"),
                item=item,
                filename=fn,
            )
        except FileNotFoundError:
            continue
        restored = fn

    # Whole-model transform may have written a new *_edited file — remove it when
    # it did not exist in the previous timeline snapshot.
    if (
        current_fn
        and parent_fn
        and current_fn != parent_fn
        and current_fn not in prev_names
        and (project_path / current_fn).is_file()
    ):
        try:
            (project_path / current_fn).unlink()
        except OSError:
            pass
        if parent_fn and (project_path / parent_fn).is_file():
            restored = parent_fn

    if restored:
        return restored
    if parent_fn and (project_path / parent_fn).is_file():
        return parent_fn
    return current_fn or parent_fn


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
    from backend.services import cad_service

    target = (entry.get("meta") or {}).get("deleted_file") or entry.get("filename")
    deleted_files = (entry.get("meta") or {}).get("deleted_files") or []
    names = [target, *([n for n in deleted_files if isinstance(n, str)])]
    manifest = entry.get("snapshot_files") or []
    if manifest:
        _restore_snapshot_manifest(project_path, manifest)
        cad_service.clear_deleted_catalogs(project_path, names)
        return
    if not target:
        cad_service.clear_deleted_catalogs(project_path, names)
        return
    from backend.services.engine_layout import normalize_rel

    cleaned = normalize_rel(target) or Path(str(target)).name
    dest = Path(project_path) / cleaned
    try:
        _materialize_snapshot_to(
            project_path,
            dest,
            snap_name=entry.get("snapshot"),
            drive_file_id=entry.get("drive_file_id"),
            filename=target,
            item=entry,
        )
    except FileNotFoundError:
        cad_service.clear_deleted_catalogs(project_path, names)
        return
    cad_service.clear_deleted_catalogs(project_path, names)


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
        "original_prompt": meta.get("original_prompt"),
        "prompt": meta.get("prompt"),
        "restorable": bool(
            e.get("snapshot")
            or e.get("snapshot_files")
            or e.get("drive_file_id")
            or e.get("drive_latest_id")
        ),
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


def _is_prompt_history_ghost(entry: dict[str, Any]) -> bool:
    """Prompt-history rows injected into the scrubber with no model snapshot.

    Stopped/failed/canceled jobs were appended as timeline buttons that cannot
    restore. Successful generates already get a snapshot via append_entry.
    """
    if entry.get("snapshot") or entry.get("snapshot_files"):
        return False
    meta = entry.get("meta") or {}
    return str(meta.get("source") or "") == "prompt_history"


def _prompt_history_timeline_meta(entry: dict[str, Any]) -> dict[str, Any]:
    meta = {
        "prompt": entry.get("prompt") or entry.get("original_prompt"),
        "original_prompt": entry.get("original_prompt"),
        "prompt_improved": entry.get("prompt_improved"),
        "prompt_id": entry.get("id"),
        "prompt_mode": entry.get("prompt_mode") or ("render" if (entry.get("kind") or "") == "render" else "standard"),
        "speed": entry.get("speed"),
        "success": entry.get("success"),
        "status": entry.get("status"),
        "error": entry.get("error"),
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
    """Enrich snapshot timeline rows with prompt-history metadata (cost, original prompt).

    Do not append prompt-history-only nodes. One successful generate already
    records one snapshot via append_entry; Stopped/failed rows made dead buttons.
    """
    try:
        from backend.services import prompt_history_service
    except Exception:
        return

    data = load_timeline(project_path)
    entries: list[dict[str, Any]] = list(data.get("entries") or [])
    current_index = data.get("current_index", -1)
    current_id = None
    if 0 <= int(current_index or -1) < len(entries):
        current_id = entries[int(current_index)].get("id")

    changed = False
    kept = [e for e in entries if not _is_prompt_history_ghost(e)]
    if len(kept) != len(entries):
        entries = kept
        changed = True

    try:
        prompt_entries = list(reversed(prompt_history_service.list_entries(project_path, limit=300)))
    except Exception:
        prompt_entries = []

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
        if target is None:
            continue
        target_meta = target.setdefault("meta", {})
        for key, value in meta.items():
            if value is not None and target_meta.get(key) != value:
                target_meta[key] = value
                changed = True

    if not changed:
        return

    entries.sort(key=lambda e: str(e.get("created_at") or ""))
    for idx, entry in enumerate(entries):
        entry["index"] = idx
    data["entries"] = entries
    if current_id:
        data["current_index"] = next(
            (i for i, e in enumerate(entries) if e.get("id") == current_id),
            len(entries) - 1,
        )
    else:
        data["current_index"] = min(max(int(current_index or -1), -1), len(entries) - 1)
    save_timeline(project_path, data)


def timeline_summary(project_path: Path, *, sync_prompts: bool = True) -> dict[str, Any]:
    if sync_prompts:
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


def _live_dest_for_filename(project_path: Path, filename: str) -> Path:
    from backend.services.engine_layout import normalize_rel, resolve_in_layout

    hit = resolve_in_layout(project_path, filename)
    if hit is not None:
        return hit
    cleaned = normalize_rel(filename) or Path(str(filename or "")).name
    return Path(project_path) / cleaned


def restore_missing_live_file(project_path: Path, filename: str) -> Path | None:
    """If a live model is gone/empty, download the last Drive backup into the project folder.

    Never overwrites a healthy local file. Returns the restored path or None.
    """
    if not filename or str(filename).startswith("history/") or "/history/" in str(filename):
        return None
    dest = _live_dest_for_filename(project_path, filename)
    if dest.is_relative_to(project_path / "history"):
        return None
    if _live_file_healthy(dest):
        return None
    file_id = _lookup_drive_id(project_path, Path(filename).name)
    if not file_id:
        # Nested engine paths store filename as basename in the manifest.
        file_id = _lookup_drive_id(project_path, str(filename))
    if not file_id:
        logger.info(
            "Auto-restore skipped (no Drive snapshot) project=%s file=%s",
            project_path.name,
            filename,
        )
        return None
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        drive_model_snapshot_service.download_file(file_id, dest)
    except Exception as exc:
        logger.error(
            "Auto-restore from Google Drive failed project=%s file=%s drive_id=%s: %s",
            project_path.name,
            filename,
            file_id,
            exc,
        )
        return None
    if not _live_file_healthy(dest):
        logger.error(
            "Auto-restore produced an empty file project=%s file=%s drive_id=%s",
            project_path.name,
            filename,
            file_id,
        )
        try:
            dest.unlink()
        except OSError:
            pass
        return None
    logger.info(
        "AUTO-RESTORE from Google Drive project=%s file=%s drive_id=%s bytes=%s",
        project_path.name,
        dest.relative_to(project_path).as_posix() if dest.is_relative_to(project_path) else dest.name,
        file_id,
        dest.stat().st_size,
    )
    return dest


_restore_lock = threading.Lock()
_restore_in_flight: set[str] = set()


def schedule_missing_live_restore(project_path: Path) -> None:
    """Restore missing Drive models after the project payload has already returned."""
    key = str(Path(project_path).resolve())
    with _restore_lock:
        if key in _restore_in_flight:
            return
        _restore_in_flight.add(key)

    def _run() -> None:
        try:
            ensure_missing_live_models(project_path)
        except Exception:
            logger.exception("Background Drive restore failed for %s", Path(project_path).name)
        finally:
            with _restore_lock:
                _restore_in_flight.discard(key)

    threading.Thread(
        target=_run,
        name=f"drive-restore-{Path(project_path).name[:12]}",
        daemon=True,
    ).start()


def ensure_missing_live_models(project_path: Path) -> list[str]:
    """On project open: restore any current/latest models that vanished locally."""
    restored: list[str] = []
    data = load_timeline(project_path)
    names: list[str] = []
    latest_map = data.get("drive_latest") or {}
    if isinstance(latest_map, dict):
        names.extend(str(k) for k in latest_map.keys())
    entries = data.get("entries") or []
    idx = data.get("current_index", -1)
    if 0 <= int(idx or -1) < len(entries):
        current = entries[int(idx)]
        if current.get("filename"):
            names.append(str(current["filename"]))
        for item in current.get("snapshot_files") or []:
            if item.get("filename"):
                names.append(str(item["filename"]))
    seen: set[str] = set()
    for name in names:
        if not name or name in seen:
            continue
        seen.add(name)
        path = restore_missing_live_file(project_path, name)
        if path is not None:
            restored.append(name)
    return restored


def _history_item_for_snap(data: dict[str, Any], snap_name: str) -> dict[str, Any] | None:
    for entry in data.get("entries") or []:
        for item in entry.get("snapshot_files") or []:
            if item.get("snapshot") == snap_name:
                return item
        if entry.get("snapshot") == snap_name:
            files = entry.setdefault("snapshot_files", [])
            if isinstance(files, list):
                for item in files:
                    if item.get("snapshot") == snap_name:
                        return item
            row = {
                "filename": entry.get("filename"),
                "snapshot": snap_name,
            }
            if isinstance(files, list):
                files.append(row)
            else:
                entry["snapshot_files"] = [row]
            return row
    return None


def _is_share_or_export_history_name(name: str) -> bool:
    lower = name.lower()
    return "_share_" in lower or "_export_" in lower or "_active_" in lower


def _find_identical_live_file(project_path: Path, blob: Path) -> Path | None:
    try:
        blob_size = blob.stat().st_size
    except OSError:
        return None
    for live in _snapshotable_model_files(project_path):
        try:
            if live.stat().st_size != blob_size:
                continue
            if filecmp.cmp(blob, live, shallow=False):
                return live
        except OSError:
            continue
    return None


def reclaim_local_history_blobs(project_path: Path) -> dict[str, int]:
    """Upload unique history CAD blobs to Drive, then delete local history copies.

    Byte-identical duplicates of the live project model are deleted without upload.
    Unique versions that fail to upload are kept. Live STLs / current 3MF/STEP
    outside history/ are never touched.
    """
    hist = _history_dir(project_path)
    stats = {
        "scanned": 0,
        "deleted_duplicate": 0,
        "deleted_after_upload": 0,
        "kept_upload_failed": 0,
        "deleted_share_sidecar": 0,
        "bytes_freed": 0,
    }
    if not hist.is_dir():
        return stats
    data = load_timeline(project_path)
    changed = False
    for blob in list(hist.iterdir()):
        if not blob.is_file():
            continue
        if blob.name.endswith(".json") or blob.name.endswith(".txt"):
            continue
        stats["scanned"] += 1
        try:
            size = blob.stat().st_size
        except OSError:
            continue
        if _is_share_or_export_history_name(blob.name):
            blob.unlink(missing_ok=True)
            stats["deleted_share_sidecar"] += 1
            stats["bytes_freed"] += size
            continue
        twin = _find_identical_live_file(project_path, blob)
        if twin is not None:
            blob.unlink(missing_ok=True)
            stats["deleted_duplicate"] += 1
            stats["bytes_freed"] += size
            logger.info(
                "Deleted local history duplicate %s (identical to live %s)",
                blob.name,
                twin.name,
            )
            continue
        item = _history_item_for_snap(data, blob.name)
        dest_name = blob.name
        filename = (item or {}).get("filename") or blob.name
        if not drive_model_snapshot_service.drive_available():
            stats["kept_upload_failed"] += 1
            logger.warning(
                "Keeping unique local history %s/%s (%s bytes) — Drive unavailable",
                project_path.name,
                blob.name,
                size,
            )
            continue
        try:
            file_id = drive_model_snapshot_service.upload_file(
                project_path.name, blob, dest_name
            )
            latest_id = None
            if filename:
                try:
                    latest_id = drive_model_snapshot_service.upload_file(
                        project_path.name, blob, _latest_name_for(str(filename))
                    )
                except Exception as exc:
                    logger.warning("Drive latest-pointer failed for reclaim %s: %s", blob.name, exc)
                    latest_id = file_id
            if item is not None:
                item["drive_file_id"] = file_id
                if latest_id:
                    item["drive_latest_id"] = latest_id
                _record_drive_latest(
                    data,
                    str(filename),
                    {"drive_file_id": file_id, "drive_latest_id": latest_id, "snapshot": dest_name, "bytes": size},
                )
                changed = True
            blob.unlink(missing_ok=True)
            stats["deleted_after_upload"] += 1
            stats["bytes_freed"] += size
            logger.info(
                "Uploaded unique history to Drive then deleted local %s/%s id=%s",
                project_path.name,
                dest_name,
                file_id,
            )
        except Exception as exc:
            stats["kept_upload_failed"] += 1
            logger.error(
                "Drive upload failed — keeping local history blob %s/%s: %s",
                project_path.name,
                blob.name,
                exc,
            )
    if changed:
        save_timeline(project_path, data)
    return stats


def reclaim_all_project_history(projects_root: Path) -> dict[str, Any]:
    totals = {
        "projects": 0,
        "scanned": 0,
        "deleted_duplicate": 0,
        "deleted_after_upload": 0,
        "kept_upload_failed": 0,
        "deleted_share_sidecar": 0,
        "bytes_freed": 0,
    }
    root = Path(projects_root)
    if not root.is_dir():
        return totals
    for project_path in sorted(root.iterdir()):
        if not project_path.is_dir():
            continue
        hist = project_path / "history"
        if not hist.is_dir():
            continue
        totals["projects"] += 1
        stats = reclaim_local_history_blobs(project_path)
        for key in (
            "scanned",
            "deleted_duplicate",
            "deleted_after_upload",
            "kept_upload_failed",
            "deleted_share_sidecar",
            "bytes_freed",
        ):
            totals[key] += stats[key]
    return totals
