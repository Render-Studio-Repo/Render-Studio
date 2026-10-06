"""Permission-scoped robot-learning dataset imports and summaries."""
from __future__ import annotations

import json
import re
import shutil
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

DATASET_ROOT = Path("references/Robots/OpenArm 2.0/Training Data")
MAX_FILES = 10000
MAX_FILE_BYTES = 4 * 1024 * 1024 * 1024
MAX_TOTAL_BYTES = 20 * 1024 * 1024 * 1024


def _safe_rel(value: str) -> PurePosixPath:
    raw = str(value or "").replace("\\", "/").strip("/")
    rel = PurePosixPath(raw)
    if not raw or len(raw) > 1000 or any(p in {"", ".", ".."} for p in rel.parts):
        raise ValueError("Dataset files must use safe relative paths.")
    return rel


def _dataset_name(value: str) -> str:
    name = re.sub(r"[^A-Za-z0-9._ -]+", "_", str(value or "dataset")).strip(" .")[:100]
    return name or "dataset"


def import_dataset(project: Path, uploads, paths: list[str], name: str) -> dict:
    root = Path(project) / DATASET_ROOT
    root.mkdir(parents=True, exist_ok=True)
    dest = root / _dataset_name(name)
    n = 2
    while dest.exists():
        dest = root / f"{_dataset_name(name)} ({n})"
        n += 1
    stage = Path(tempfile.mkdtemp(prefix=".dataset-", dir=root))
    written = 0
    total = 0
    try:
        if len(uploads) == 1 and str(uploads[0].filename or "").lower().endswith(".zip"):
            with zipfile.ZipFile(uploads[0].file) as archive:
                entries = [x for x in archive.infolist() if not x.is_dir()]
                if len(entries) > MAX_FILES:
                    raise ValueError("Dataset archive contains too many files.")
                for info in entries:
                    rel = _safe_rel(info.filename)
                    if info.file_size > MAX_FILE_BYTES or total + info.file_size > MAX_TOTAL_BYTES:
                        raise ValueError("Dataset exceeds the import size limit.")
                    target = stage.joinpath(*rel.parts)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with archive.open(info) as source, target.open("wb") as sink:
                        shutil.copyfileobj(source, sink, 1024 * 1024)
                    total += info.file_size
                    written += 1
        else:
            if len(uploads) > MAX_FILES:
                raise ValueError("Dataset contains too many files.")
            for upload, raw in zip(uploads, paths or [u.filename for u in uploads], strict=False):
                rel = _safe_rel(raw or upload.filename)
                target = stage.joinpath(*rel.parts)
                target.parent.mkdir(parents=True, exist_ok=True)
                size = 0
                with target.open("wb") as sink:
                    while chunk := upload.file.read(1024 * 1024):
                        size += len(chunk)
                        total += len(chunk)
                        if size > MAX_FILE_BYTES or total > MAX_TOTAL_BYTES:
                            raise ValueError("Dataset exceeds the import size limit.")
                        sink.write(chunk)
                written += 1
        if not written:
            raise ValueError("Dataset import is empty.")
        stage.rename(dest)
        return {"ok": True, "name": dest.name, "root": dest.relative_to(project).as_posix(), "files": written, "bytes": total}
    except Exception:
        shutil.rmtree(stage, ignore_errors=True)
        raise


def summary(project: Path) -> dict:
    root = Path(project) / DATASET_ROOT
    datasets = []
    if root.is_dir():
        for folder in sorted((p for p in root.iterdir() if p.is_dir() and not p.name.startswith(".")), key=lambda p: p.stat().st_mtime, reverse=True):
            files = [p for p in folder.rglob("*") if p.is_file()]
            episodes = sum(1 for p in files if "episode" in p.name.lower() and p.suffix.lower() in {".json", ".jsonl", ".parquet"})
            videos = sum(1 for p in files if p.suffix.lower() in {".mp4", ".webm", ".mov"})
            storage = "local"
            remote_bytes = 0
            try:
                profile = json.loads((folder / "robotics-profile.json").read_text())
                dataset = profile.get("dataset") or {}
                if dataset.get("storage") == "hub_stream":
                    storage = "hub_stream"
                    episodes = int(dataset.get("episodes") or 0)
                    videos = len([name for name in profile.get("observations") or [] if "images." in str(name)])
                    remote_bytes = int(dataset.get("remote_bytes") or 0)
            except Exception:
                pass
            try:
                remote = json.loads((folder / "remote-dataset.json").read_text())
                if remote.get("schema") == "render3d.remote-dataset.v1" and remote.get("streaming") is True:
                    storage = "hub_stream"
                    episodes = int(remote.get("episodes") or episodes)
                    videos = int(remote.get("videos") or videos)
                    remote_bytes = int(remote.get("remote_bytes") or 0)
            except Exception:
                pass
            try:
                local = json.loads((folder / "local-snapshot.json").read_text())
                if local.get("schema") == "render3d.huggingface-snapshot.v1" and local.get("complete") is True:
                    storage = "local_mirror"
            except Exception:
                pass
            successes = failures = 0
            for report in [folder / "reports/evaluation.json", folder / "meta/stats.json"]:
                try:
                    row = json.loads(report.read_text())
                    successes += int(row.get("successes", 0))
                    failures += int(row.get("failures", 0))
                except Exception:
                    pass
            datasets.append({"name": folder.name, "root": folder.relative_to(project).as_posix(), "files": len(files), "bytes": sum(p.stat().st_size for p in files), "remote_bytes": remote_bytes, "storage": storage, "episodes": episodes, "videos": videos, "successes": successes, "failures": failures})
    return {"ok": True, "root": DATASET_ROOT.as_posix(), "datasets": datasets}
