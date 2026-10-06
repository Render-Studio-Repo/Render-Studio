"""Per-project CAD history snapshots on Google Drive (not local disk).

Uses the same OAuth token as ``scripts/backup-to-drive.py``
(``~/.config/render3d/token_google_drive_backup.pickle``) and the models
folder ``RENDER3D_DRIVE_BACKUP_FOLDER_ID``.

Layout::

    {PARENT}/model-history/{project_id}/{snapshot_name}
    {PARENT}/model-history/{project_id}/latest__{flat_filename}

Tests can swap the backend via ``set_backend``.
"""

from __future__ import annotations

import importlib.util
import io
import logging
import os
import threading
from pathlib import Path
from typing import Any, Protocol

logger = logging.getLogger(__name__)

HISTORY_FOLDER_NAME = "model-history"
PARENT_FOLDER_ID = os.getenv(
    "RENDER3D_DRIVE_BACKUP_FOLDER_ID",
    "1ovSbfq6D8kNlL72CJcNueRdKKDsOgt6M",
)

_backend_lock = threading.Lock()
_folder_cache: dict[str, str] = {}
_service = None
_service_error: str | None = None
_backup_mod = None
_injected_backend: "DriveBackend | None" = None


class DriveBackend(Protocol):
    def available(self) -> bool: ...
    def upload_file(self, project_id: str, local_path: Path, dest_name: str, existing_id: str | None = None) -> str: ...
    def download_file(self, file_id: str, dest_path: Path) -> None: ...
    def delete_file(self, file_id: str) -> None: ...


class MemoryDriveBackend:
    """In-memory Drive stand-in for unit tests."""

    def __init__(self) -> None:
        self.files: dict[str, bytes] = {}
        self.names: dict[str, str] = {}
        self._n = 0
        self.fail_uploads = False

    def available(self) -> bool:
        return not self.fail_uploads or bool(self.files)

    def upload_file(self, project_id: str, local_path: Path, dest_name: str, existing_id: str | None = None) -> str:
        if self.fail_uploads:
            raise RuntimeError("Drive upload disabled (test)")
        data = Path(local_path).read_bytes()
        file_id = existing_id or f"mem-{project_id}-{dest_name}-{self._n}"
        if not existing_id:
            self._n += 1
        self.files[file_id] = data
        self.names[file_id] = dest_name
        return file_id

    def download_file(self, file_id: str, dest_path: Path) -> None:
        if file_id not in self.files:
            raise FileNotFoundError(f"Drive snapshot missing: {file_id}")
        dest_path = Path(dest_path)
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest_path.with_name(dest_path.name + ".drive-restore.tmp")
        tmp.write_bytes(self.files[file_id])
        tmp.replace(dest_path)

    def delete_file(self, file_id: str) -> None:
        self.files.pop(file_id, None)
        self.names.pop(file_id, None)


def set_backend(backend: DriveBackend | None) -> None:
    global _injected_backend
    _injected_backend = backend


def _load_backup_mod() -> Any:
    global _backup_mod
    if _backup_mod is not None:
        return _backup_mod
    root = Path(__file__).resolve().parents[2]
    script = root / "scripts" / "backup-to-drive.py"
    spec = importlib.util.spec_from_file_location("render3d_backup_to_drive", script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load Drive backup script: {script}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    _backup_mod = mod
    return mod


def _drive_service():
    global _service, _service_error
    if _service is not None:
        return _service
    with _backend_lock:
        if _service is not None:
            return _service
        try:
            mod = _load_backup_mod()
            _service = mod.get_drive_service()
            _service_error = None
            return _service
        except Exception as exc:
            _service_error = str(exc)
            logger.warning("Google Drive model snapshots unavailable: %s", exc)
            return None


def drive_available() -> bool:
    if _injected_backend is not None:
        return bool(_injected_backend.available())
    return _drive_service() is not None


def drive_unavailable_reason() -> str | None:
    if _injected_backend is not None:
        return None if _injected_backend.available() else "injected backend unavailable"
    _drive_service()
    return _service_error


def _ensure_child_folder(service, parent_id: str, name: str) -> str:
    cache_key = f"{parent_id}/{name}"
    cached = _folder_cache.get(cache_key)
    if cached:
        return cached
    mod = _load_backup_mod()
    folder_id = mod.drive_create_folder(service, name, parent_id)
    _folder_cache[cache_key] = folder_id
    return folder_id


def project_history_folder_id(project_id: str) -> str:
    service = _drive_service()
    if service is None:
        raise RuntimeError(drive_unavailable_reason() or "Google Drive not authenticated")
    root = _ensure_child_folder(service, PARENT_FOLDER_ID, HISTORY_FOLDER_NAME)
    return _ensure_child_folder(service, root, str(project_id))


def _atomic_write(dest_path: Path, writer) -> None:
    dest_path = Path(dest_path)
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest_path.with_name(dest_path.name + ".drive-restore.tmp")
    try:
        writer(tmp)
        tmp.replace(dest_path)
    except Exception:
        tmp.unlink(missing_ok=True)
        raise


def upload_file(project_id: str, local_path: Path, dest_name: str, existing_id: str | None = None) -> str:
    """Upload or update a snapshot. Returns Drive file id."""
    if _injected_backend is not None:
        return _injected_backend.upload_file(project_id, Path(local_path), dest_name, existing_id)
    service = _drive_service()
    if service is None:
        raise RuntimeError(drive_unavailable_reason() or "Google Drive not authenticated")
    folder_id = project_history_folder_id(project_id)
    from googleapiclient.http import MediaFileUpload

    media = MediaFileUpload(str(local_path), mimetype="application/octet-stream", resumable=True)
    if existing_id:
        updated = (
            service.files()
            .update(
                fileId=existing_id,
                media_body=media,
                fields="id",
                supportsAllDrives=True,
            )
            .execute()
        )
        file_id = updated["id"]
    else:
        mod = _load_backup_mod()
        found = mod.drive_find_file(service, dest_name, folder_id)
        if found:
            updated = (
                service.files()
                .update(
                    fileId=found,
                    media_body=media,
                    fields="id",
                    supportsAllDrives=True,
                )
                .execute()
            )
            file_id = updated["id"]
        else:
            created = (
                service.files()
                .create(
                    body={"name": dest_name, "parents": [folder_id]},
                    media_body=media,
                    fields="id",
                    supportsAllDrives=True,
                )
                .execute()
            )
            file_id = created["id"]
    logger.info(
        "Drive model snapshot uploaded project=%s name=%s id=%s bytes=%s",
        project_id,
        dest_name,
        file_id,
        Path(local_path).stat().st_size,
    )
    return file_id


def download_file(file_id: str, dest_path: Path) -> None:
    if _injected_backend is not None:
        _injected_backend.download_file(file_id, Path(dest_path))
        return
    service = _drive_service()
    if service is None:
        raise RuntimeError(drive_unavailable_reason() or "Google Drive not authenticated")
    from googleapiclient.http import MediaIoBaseDownload

    dest_path = Path(dest_path)

    def _write(tmp: Path) -> None:
        request = service.files().get_media(fileId=file_id, supportsAllDrives=True)
        with io.FileIO(tmp, "wb") as fh:
            downloader = MediaIoBaseDownload(fh, request)
            done = False
            while not done:
                _, done = downloader.next_chunk()

    _atomic_write(dest_path, _write)
    logger.info("Drive model snapshot downloaded id=%s → %s", file_id, dest_path)


def delete_file(file_id: str) -> None:
    if not file_id:
        return
    if _injected_backend is not None:
        _injected_backend.delete_file(file_id)
        return
    service = _drive_service()
    if service is None:
        return
    try:
        service.files().delete(fileId=file_id, supportsAllDrives=True).execute()
    except Exception as exc:
        logger.warning("Could not delete Drive snapshot %s: %s", file_id, exc)
