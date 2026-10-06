"""Optional compare-and-swap for Canvas documents, shared by all server workers.

The legacy Canvas payload stays compatible. A storage revision hashes the exact
saved bytes; flock and atomic replacement prevent partial or lost VR board saves.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import tempfile
from typing import Any

from backend.services import cad_service


class CanvasBoardConflict(ValueError):
    """A board changed since the caller last loaded it."""


def _revision(raw: bytes | None) -> str:
    return hashlib.sha256(raw).hexdigest() if raw is not None else "missing"


@contextmanager
def _locked_board(project_path: Path, name: str, *, create: bool = False):
    folder = cad_service.canvas_store_dir(project_path, name, create=create)
    if not folder.is_dir():
        yield folder / "canvas.json"
        return
    # A separate stable lock inode survives replacing canvas.json atomically.
    with (folder / ".canvas-board.lock").open("a+b") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        try:
            yield folder / "canvas.json"
        finally:
            fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


def read_canvas_board(project_path: Path, name: str) -> dict[str, Any] | None:
    with _locked_board(project_path, name) as dest:
        try:
            raw = dest.read_bytes()
        except FileNotFoundError:
            return None
        try:
            data = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            return None
        if not isinstance(data, dict):
            return None
        return {**data, "storage_revision": _revision(raw)}


def write_canvas_board(
    project_path: Path,
    name: str,
    state: dict[str, Any] | None = None,
    *,
    expected_revision: str | None = None,
) -> tuple[Path, str]:
    payload = {
        "name": cad_service.sanitize_canvas_store_name(name),
        "state": state if isinstance(state, dict) else {},
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    with _locked_board(project_path, name, create=True) as dest:
        try:
            previous = dest.read_bytes()
        except FileNotFoundError:
            previous = None
        if expected_revision is not None and expected_revision != _revision(previous):
            raise CanvasBoardConflict("This Draw board changed in another session. Reload it before saving again; your local edits are still available.")
        if expected_revision is None and previous:
            # Older desktop Canvas clients save the 2D envelope unconditionally.
            # They must not overwrite a newer spatial document they don't own.
            try:
                old_state = json.loads(previous).get("state", {})
                if isinstance(old_state, dict) and isinstance(old_state.get("spatial_board"), dict):
                    payload["state"] = {**payload["state"], "spatial_board": old_state["spatial_board"]}
            except (ValueError, UnicodeDecodeError, AttributeError):
                pass
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        tmp = None
        try:
            with tempfile.NamedTemporaryFile(dir=dest.parent, prefix=".canvas-", suffix=".tmp", delete=False) as stream:
                tmp = Path(stream.name)
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(tmp, dest)
            tmp = None
        finally:
            if tmp is not None:
                tmp.unlink(missing_ok=True)
        return dest, _revision(raw)
