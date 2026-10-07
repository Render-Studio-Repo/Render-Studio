"""Bounded Hugging Face robotics dataset search and confirmed file retrieval."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx

HF_API = "https://huggingface.co/api/datasets"
ALLOWED_SUFFIXES = {
    ".json", ".jsonl", ".parquet", ".arrow", ".csv", ".yaml", ".yml",
    ".xml", ".urdf", ".xacro", ".mjcf", ".sdf", ".zip", ".tar", ".gz", ".h5",
    ".hdf5", ".mcap", ".db3", ".mp4", ".webm", ".png", ".jpg", ".jpeg",
    ".glb", ".gltf", ".stl", ".obj", ".dae", ".npz", ".npy", ".pt", ".pth",
    ".onnx", ".safetensors", ".ckpt", ".toml", ".ini", ".cfg",
}
MAX_DOWNLOAD_BYTES = 250 * 1024 * 1024
_REPO = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")


def _safe_repo(value: str) -> str:
    repo = str(value or "").strip()
    if not _REPO.fullmatch(repo):
        raise ValueError("Choose a valid Hugging Face dataset repository.")
    return repo


def _safe_filename(value: str) -> str:
    name = str(value or "").strip().replace("\\", "/")
    parts = Path(name).parts
    if not parts or name.startswith("/") or any(part in {"", ".", ".."} for part in parts):
        raise ValueError("Choose a safe dataset file path.")
    suffixes = Path(name).suffixes
    if not suffixes or suffixes[-1].lower() not in ALLOWED_SUFFIXES:
        raise ValueError("That file type is not allowed in the robot data explorer.")
    return "/".join(parts)


def _file_rows(item: dict[str, Any]) -> list[dict[str, Any]]:
    rows = []
    for entry in (item.get("siblings") or [])[:400]:
        if not isinstance(entry, dict):
            continue
        name = str(entry.get("rfilename") or "")
        try:
            safe = _safe_filename(name)
        except ValueError:
            continue
        size = entry.get("size")
        if size is None and isinstance(entry.get("lfs"), dict):
            size = entry["lfs"].get("size")
        rows.append({
            "name": safe,
            "size": int(size) if isinstance(size, (int, float)) and size >= 0 else None,
        })
    return rows[:60]


def search_datasets(query: str, *, robot: str = "", simulator: str = "", limit: int = 8) -> dict[str, Any]:
    robot_name = re.sub(r"\b(?:v(?:ersion)?\s*)?\d+(?:\.\d+)*\b", " ", str(robot or ""), flags=re.I)
    robot_name = " ".join(re.findall(r"[A-Za-z0-9_-]+", robot_name)).strip()
    task_words = re.findall(r"\b(cube|block|pick|place|grasp|stack|sort|drawer|door|cloth|pour|push)\b", str(query or ""), flags=re.I)
    terms = " ".join(dict.fromkeys([robot_name, *[word.lower() for word in task_words]]))[:120]
    if not terms:
        terms = " ".join(part for part in (robot, simulator, query) if str(part or "").strip()).strip()[:300]
    if not terms:
        return {"query": "", "datasets": [], "source": "huggingface"}
    try:
        response = httpx.get(HF_API, params={"search": terms, "limit": max(1, min(int(limit), 12)), "full": "true"}, timeout=15.0)
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:
        raise RuntimeError("Hugging Face dataset search is unavailable.") from exc
    datasets = []
    for item in payload if isinstance(payload, list) else []:
        if not isinstance(item, dict):
            continue
        repo = str(item.get("id") or "")
        if not _REPO.fullmatch(repo):
            continue
        datasets.append({
            "id": repo,
            "author": str(item.get("author") or repo.split("/", 1)[0])[:120],
            "url": f"https://huggingface.co/datasets/{quote(repo, safe='/')}",
            "downloads": max(0, int(item.get("downloads") or 0)),
            "likes": max(0, int(item.get("likes") or 0)),
            "last_modified": item.get("lastModified"),
            "tags": [str(tag)[:100] for tag in (item.get("tags") or [])[:20]],
            "files": _file_rows(item),
        })
    return {"query": terms, "datasets": datasets, "source": "huggingface"}


def retrieve_dataset_file(repo_id: str, filename: str, *, destination_root: Path | None = None) -> dict[str, Any]:
    repo = _safe_repo(repo_id)
    safe_name = _safe_filename(filename)
    if destination_root is None:
        from backend.config import settings
        storage_root = (Path(settings.data_dir) / "robot-datasets").resolve()
    else:
        storage_root = Path(destination_root).resolve()
    repo_root = (storage_root / repo).resolve()
    destination = repo_root.joinpath(*Path(safe_name).parts)
    if not destination.resolve().is_relative_to(repo_root):
        raise ValueError("Invalid dataset destination.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp = destination.with_suffix(destination.suffix + ".part")
    url = f"https://huggingface.co/datasets/{quote(repo, safe='/')}/resolve/main/{quote(safe_name, safe='/')}"
    total = 0
    try:
        with httpx.stream("GET", url, follow_redirects=True, timeout=90.0) as response:
            response.raise_for_status()
            announced = int(response.headers.get("content-length") or 0)
            if announced > MAX_DOWNLOAD_BYTES:
                raise ValueError("Dataset file exceeds the 250 MB explorer limit.")
            with temp.open("wb") as handle:
                for chunk in response.iter_bytes():
                    total += len(chunk)
                    if total > MAX_DOWNLOAD_BYTES:
                        raise ValueError("Dataset file exceeds the 250 MB explorer limit.")
                    handle.write(chunk)
        temp.replace(destination)
    except Exception:
        temp.unlink(missing_ok=True)
        raise
    return {
        "ok": True,
        "repo_id": repo,
        "filename": safe_name,
        "bytes": total,
        "destination": str(destination.relative_to(storage_root)),
        "source_url": url,
    }
