"""Viewport live-draw previews during CAD / Mesh generation.

As soon as a GLB exists mid-run, generation progress carries ``preview_*``
fields so the client can load that file immediately — inspect/review/finalize
keep running in the background.

Memory contract: one draft file on disk (overwrite, never a stack of
snapshots), skip huge tessellations, and never polish drafts twice.
"""

from __future__ import annotations

import re
import shutil
import threading
import time
from pathlib import Path
from typing import Any, Callable, Optional

ProgressCb = Optional[Callable[[dict[str, Any]], None]]

PREVIEW_KEYS = (
    "preview_filename",
    "preview_mtime",
    "preview_bytes",
    "preview_seq",
    "preview_part",
    "preview_parts",
    "preview_append",
)

MIN_PREVIEW_BYTES = 80
MAX_PREVIEW_BYTES = 48 * 1024 * 1024
MAX_STEP_PREVIEW_BYTES = 80 * 1024 * 1024
# Don't retessellate giant STEP assemblies on the live-preview thread — that
# stalls the same machine the user is orbiting.
MAX_LIVE_TESSELLATE_STEP_BYTES = 8 * 1024 * 1024
LIVE_SUFFIX = ".generation-live.glb"
_SKIP_NAME_TOKS = ("_snapshot", "_edited", "__faceted", "_exploded", "_share_visible")
_CATALOG_STEM_RE = re.compile(r"^\d{4,}[A-Z]?\d+", re.I)
_WRITE_SETTLE_SEC = 0.45
_LIVE_INFIX_RE = re.compile(r"\.generation-live(?=\.)", re.I)


def _preview_project_root(glb: Path) -> Path:
    parent = Path(glb).resolve().parent
    from backend.services.engine_layout import ENGINE_FOLDER_SET

    if parent.name in ENGINE_FOLDER_SET:
        return parent.parent
    return parent


def preview_design_stem(path: Path | str | None) -> str:
    """Published / live-sidecar GLBs of the same part share one stem (not a new object)."""
    name = Path(str(path or "")).name
    cleaned = _LIVE_INFIX_RE.sub("", name)
    from backend.services.engine_layout import model_stem

    return model_stem(cleaned).lower()


def has_settled_design_siblings(project_path: Path, excluding: Path | None = None) -> bool:
    """True when the viewport already has a designed mesh that should stay on screen."""
    root = Path(project_path)
    skip = Path(excluding).resolve() if excluding is not None else None
    skip_stem = preview_design_stem(skip) if skip is not None else ""
    try:
        from backend.services.engine_layout import iter_design_files
    except Exception:
        return False
    for path in iter_design_files(root):
        if path.suffix.lower() not in {".glb", ".gltf"}:
            continue
        name = path.name.lower()
        if any(tok in name for tok in _SKIP_NAME_TOKS) or ".generation-live." in name:
            continue
        if _catalog_stem(path.name):
            continue
        try:
            if skip is not None and path.resolve() == skip:
                continue
            if skip_stem and preview_design_stem(path) == skip_stem:
                continue
            if path.stat().st_size < MIN_PREVIEW_BYTES:
                continue
        except OSError:
            continue
        return True
    return False


def live_preview_path(glb: Path) -> Path:
    path = Path(glb)
    name = path.name
    if name.lower().endswith(LIVE_SUFFIX):
        return path
    return path.with_name(f"{path.stem}{LIVE_SUFFIX}")


def is_live_preview_name(name: str) -> bool:
    lower = str(name or "").lower()
    return ".generation-live." in lower


def should_publish_part_preview(index_1: int, total: int) -> bool:
    """Cap GLB rewrites so a 40-body assembly does not tessellate 40 full scenes."""
    if total <= 10:
        return True
    if index_1 <= 1 or index_1 >= total:
        return True
    step = max(1, (total + 7) // 8)
    return index_1 % step == 0


def preview_payload(
    glb: Path,
    *,
    part_index: int | None = None,
    part_count: int | None = None,
    append: bool = False,
) -> dict[str, Any] | None:
    path = Path(glb)
    try:
        st = path.stat()
    except OSError:
        return None
    if st.st_size < MIN_PREVIEW_BYTES or st.st_size > MAX_PREVIEW_BYTES:
        return None
    from backend.services.engine_layout import preview_rel

    payload: dict[str, Any] = {
        "preview_filename": preview_rel(path),
        "preview_mtime": float(st.st_mtime),
        "preview_bytes": int(st.st_size),
        "preview_seq": (int(st.st_mtime * 1000) & 0x7FFFFFFF) ^ int(st.st_size),
        "preview_append": bool(append),
    }
    if part_index is not None:
        payload["preview_part"] = int(part_index)
    if part_count is not None:
        payload["preview_parts"] = int(part_count)
    return payload


def copy_preview_keys(src: dict[str, Any] | None, dest: dict[str, Any]) -> None:
    if not isinstance(src, dict):
        return
    for key in PREVIEW_KEYS:
        if key in src and src[key] is not None:
            dest[key] = src[key]


def emit_live_preview(
    cb: ProgressCb,
    glb: Path,
    *,
    label: str | None = None,
    stage: str | None = None,
    pct: int | None = None,
    part_index: int | None = None,
    part_count: int | None = None,
    append: bool = False,
    extra: dict[str, Any] | None = None,
) -> bool:
    if not cb:
        return False
    payload = preview_payload(glb, part_index=part_index, part_count=part_count, append=append)
    if not payload:
        return False
    if not append:
        try:
            if has_settled_design_siblings(_preview_project_root(glb), excluding=glb):
                payload["preview_append"] = True
        except Exception:
            pass
    if label:
        payload["label"] = label
        payload["thinking"] = label
    if stage:
        payload["stage"] = stage
    if pct is not None:
        payload["pct"] = pct
    if extra:
        payload.update(extra)
    cb(payload)
    return True


def cleanup_live_sidecar(glb: Path) -> None:
    live = live_preview_path(glb)
    for path in (live, Path(str(live) + ".tmp")):
        try:
            if path.is_file():
                path.unlink()
        except OSError:
            pass


def _catalog_stem(name: str) -> bool:
    stem = Path(name).name.lstrip(".")
    stem = stem.split(".")[0]
    return bool(_CATALOG_STEM_RE.fullmatch(stem))


def _skip_preview_name(name: str) -> bool:
    lower = str(name or "").lower()
    if lower.endswith(".stl"):
        return True
    return any(tok in lower for tok in _SKIP_NAME_TOKS)


def _file_settled(st, *, now: float | None = None) -> bool:
    return (now or time.time()) - float(st.st_mtime) >= _WRITE_SETTLE_SEC


def _iter_preview_candidates(
    project_path: Path,
    suffixes: tuple[str, ...],
    *,
    min_mtime: float | None = None,
    min_bytes: int,
    max_bytes: int,
    prefer_design: bool = True,
) -> Path | None:
    root = Path(project_path)
    if not root.is_dir():
        return None
    slack = 2.0
    now = time.time()
    best: Path | None = None
    best_key: tuple = ()
    design_exists = False
    files: list[tuple[Path, Any]] = []
    try:
        entries = list(root.iterdir())
    except OSError:
        return None
    for path in entries:
        if not path.is_file():
            continue
        name = path.name.lower()
        if not name.endswith(suffixes):
            continue
        if _skip_preview_name(name):
            continue
        try:
            st = path.stat()
        except OSError:
            continue
        if st.st_size < min_bytes or st.st_size > max_bytes:
            continue
        if min_mtime is not None and st.st_mtime < (min_mtime - slack):
            continue
        if not _file_settled(st, now=now):
            continue
        files.append((path, st))
        if prefer_design and not _catalog_stem(path.name) and "_exploded" not in name:
            design_exists = True
    for path, st in files:
        name = path.name.lower()
        catalog = _catalog_stem(path.name)
        if prefer_design and design_exists and catalog:
            continue
        exploded = "_exploded" in name
        if exploded:
            continue
        hidden = path.name.startswith(".")
        live = ".generation-live." in name
        # Prefer a live sidecar over the full export so the viewport stays light.
        key = (st.st_mtime, 0 if hidden else 1, 1 if live else 0, st.st_size)
        if not best_key or key >= best_key:
            best = path
            best_key = key
    return best


def find_newest_preview_glb(
    project_path: Path,
    *,
    min_mtime: float | None = None,
    min_bytes: int = MIN_PREVIEW_BYTES,
) -> Path | None:
    """Newest viewport-ready GLB in a project folder (including Jake hidden sidecars)."""
    return _iter_preview_candidates(
        project_path,
        (".glb",),
        min_mtime=min_mtime,
        min_bytes=min_bytes,
        max_bytes=MAX_PREVIEW_BYTES,
    )


def find_newest_preview_step(
    project_path: Path,
    *,
    min_mtime: float | None = None,
) -> Path | None:
    return _iter_preview_candidates(
        project_path,
        (".step", ".stp"),
        min_mtime=min_mtime,
        min_bytes=MIN_PREVIEW_BYTES,
        max_bytes=MAX_STEP_PREVIEW_BYTES,
    )


def _visible_live_dest(hidden_glb: Path) -> Path:
    stem = hidden_glb.name.lstrip(".")
    lower = stem.lower()
    if lower.endswith(".step.glb"):
        stem = stem[: -len(".step.glb")]
    elif lower.endswith(".glb"):
        stem = stem[:-4]
    stem = stem.strip(".") or "model"
    return hidden_glb.with_name(f"{stem}{LIVE_SUFFIX}")


def ensure_client_visible_glb(glb: Path) -> Path | None:
    """Copy Jake hidden sidecars to a fetchable ``*.generation-live.glb`` name."""
    path = Path(glb)
    if not path.is_file():
        return None
    dest = path if not path.name.startswith(".") else _visible_live_dest(path)
    if dest.resolve() != path.resolve():
        try:
            need = (
                not dest.is_file()
                or dest.stat().st_mtime + 0.05 < path.stat().st_mtime
                or dest.stat().st_size != path.stat().st_size
            )
            if need:
                shutil.copy2(path, dest)
        except OSError:
            return path if not path.name.startswith(".") else None
    return dest if dest.is_file() else None


def publish_live_preview(
    cb: ProgressCb,
    project_path: Path,
    *,
    min_mtime: float | None = None,
    extra: dict[str, Any] | None = None,
    last_sig: dict[str, Any] | None = None,
    label: str = "CAD · drawing in viewport…",
) -> bool:
    """Emit the newest settled GLB, tessellating a fresh STEP when that is all we have."""
    if not cb:
        return False
    if last_sig is not None and last_sig.get("busy"):
        return False
    glb = find_newest_preview_glb(project_path, min_mtime=min_mtime)
    step = find_newest_preview_step(project_path, min_mtime=min_mtime)
    if step is not None:
        step_mtime = step.stat().st_mtime
        glb_mtime = glb.stat().st_mtime if glb is not None else 0.0
        if glb is None or step_mtime > glb_mtime + 0.8:
            dest = live_preview_path(step.with_suffix(".glb"))
            tess_key = f"{step.name}:{step.stat().st_mtime_ns}:{step.stat().st_size}"
            step_bytes = int(step.stat().st_size)
            skip_heavy = glb is not None and step_bytes > MAX_LIVE_TESSELLATE_STEP_BYTES
            if skip_heavy:
                pass
            elif last_sig is None or last_sig.get("tess") != tess_key:
                if last_sig is not None:
                    last_sig["busy"] = True
                try:
                    from backend.services import cad_service

                    cad_service.tessellate_step_to_glb(step, dest)
                    glb = dest if dest.is_file() else glb
                    if last_sig is not None:
                        last_sig["tess"] = tess_key
                except Exception:
                    pass
                finally:
                    if last_sig is not None:
                        last_sig["busy"] = False
    if glb is None:
        return False
    visible = ensure_client_visible_glb(glb)
    if visible is None:
        return False
    try:
        st = visible.stat()
        sig = f"{visible.name}:{st.st_mtime_ns}:{st.st_size}"
    except OSError:
        return False
    if last_sig is not None and last_sig.get("v") == sig:
        return False
    ok = emit_live_preview(
        cb,
        visible,
        label=label,
        stage="step",
        pct=52,
        extra=extra,
    )
    if ok and last_sig is not None:
        last_sig["v"] = sig
    return ok


def start_live_preview_watcher(
    project_path: Path,
    cb: ProgressCb,
    *,
    min_mtime: float,
    extra_fn: Callable[[], dict[str, Any]] | None = None,
    interval: float = 1.4,
) -> tuple[threading.Event, threading.Thread]:
    """Poll for new STEP/GLB even when the agent is silent (no stdout)."""
    stop = threading.Event()
    last_sig: dict[str, Any] = {}

    def _loop() -> None:
        while not stop.is_set():
            extra = None
            if extra_fn:
                try:
                    extra = extra_fn() or None
                except Exception:
                    extra = None
            try:
                publish_live_preview(
                    cb,
                    project_path,
                    min_mtime=min_mtime,
                    extra=extra,
                    last_sig=last_sig,
                )
            except Exception:
                pass
            if stop.wait(interval):
                break

    thread = threading.Thread(target=_loop, name="live-preview-watch", daemon=True)
    thread.start()
    return stop, thread
