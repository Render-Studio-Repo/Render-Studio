"""Imagine images + public CAD fetch into project/imagine/."""

from __future__ import annotations

import io
import json
import re
import zipfile
from pathlib import Path
from typing import Any
from uuid import uuid4

from backend.services import cad_service, part_profiles_service, url_document_service

IMAGINE_DIRNAME = "imagine"
IMAGINE_FETCHED_DIRNAME = "fetched"
OPENAI_IMAGINE_MODELS = (
    "gpt-image-2.5-flare",
    "gpt-image-2.5-sunburst",
    "gpt-image-2",
    "gpt-image-1.5",
    "gpt-image-1",
)
OPENAI_IMAGINE_QUALITY_MODELS = (
    "gpt-image-2.5-sunburst",
    "gpt-image-2.5-flare",
    "gpt-image-2",
    "gpt-image-1.5",
    "gpt-image-1",
)
GROK_IMAGINE_MODELS = ("grok-imagine-image", "grok-2-image")
IMAGINE_META_SUFFIX = ".imagine.json"
IMAGINE_HISTORY_NAME = "_history.json"
FETCH_CAD_SUFFIXES = {".step", ".stp", ".stl", ".glb", ".gltf", ".3mf"}
FETCH_ARCHIVE_SUFFIXES = {".zip"}
FETCH_MAX_BYTES = 80_000_000
_SLUG_RE = re.compile(r"[^a-z0-9]+")


def imagine_dir(project_path: Path) -> Path:
    path = Path(project_path) / IMAGINE_DIRNAME
    path.mkdir(parents=True, exist_ok=True)
    return path


def imagine_fetched_dir(project_path: Path) -> Path:
    path = imagine_dir(project_path) / IMAGINE_FETCHED_DIRNAME
    path.mkdir(parents=True, exist_ok=True)
    return path


def is_imagine_rel(filename: str | None) -> bool:
    raw = str(filename or "").replace("\\", "/").lstrip("./")
    return raw == IMAGINE_DIRNAME or raw.startswith(f"{IMAGINE_DIRNAME}/")


def reference_prompt_block(references: list[Any] | None) -> str:
    lines: list[str] = []
    for ref in references or []:
        if not isinstance(ref, dict):
            continue
        token = str(ref.get("token") or "").strip()
        name = str(ref.get("name") or "").strip()
        kind = str(ref.get("type") or "file").strip() or "file"
        if not token and not name:
            continue
        extra = f" {name}" if name and token and token.lstrip("@") != name and token != name else ""
        lines.append(f"- {token or name}: {kind}{extra}".strip())
        text = str(ref.get("text") or "").strip()
        if text:
            lines.append(text[:4000])
    if not lines:
        return ""
    return "Attached as reference:\n" + "\n".join(lines)


def is_imagine_sidecar_name(name: str | None) -> bool:
    raw = str(name or "")
    return (
        raw.endswith(IMAGINE_META_SUFFIX)
        or raw.endswith(".markup.json")
        or raw == IMAGINE_HISTORY_NAME
        or raw.startswith(".")
    )


def imagine_meta_path(image_path: Path) -> Path:
    return image_path.with_name(f"{image_path.name}{IMAGINE_META_SUFFIX}")


def sanitize_imagine_label(label: str) -> str:
    return " ".join(str(label or "").split()).strip()[:80]


def read_imagine_meta(image_path: Path) -> dict[str, Any]:
    meta = imagine_meta_path(image_path)
    if not meta.is_file():
        return {}
    try:
        data = json.loads(meta.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def write_imagine_meta(image_path: Path, payload: dict[str, Any]) -> dict[str, Any]:
    current = read_imagine_meta(image_path)
    for key, value in (payload or {}).items():
        if value is None:
            continue
        current[key] = value
    imagine_meta_path(image_path).write_text(json.dumps(current, indent=2), encoding="utf-8")
    return current


def rename_imagine_label(project_path: Path, rel_name: str, label: str) -> dict[str, Any]:
    rel = str(rel_name or "").replace("\\", "/").lstrip("./")
    if not is_imagine_rel(rel):
        raise ValueError("Not an Imagine file")
    path = Path(project_path) / rel
    if not path.is_file() or is_imagine_sidecar_name(path.name):
        raise FileNotFoundError("Imagine file not found")
    clean = sanitize_imagine_label(label)
    if not clean:
        raise ValueError("Name is required")
    meta = write_imagine_meta(path, {"label": clean})
    return {
        "name": rel,
        "label": meta.get("label") or clean,
        "prompt": str(meta.get("prompt") or ""),
    }


def filename_from_prompt(prompt: str, *, suffix: str | None = None, ext: str = "png", index: int = 0) -> str:
    slug = _SLUG_RE.sub("-", str(prompt or "").lower())
    slug = re.sub(r"https?:-+\S+", "", slug)
    slug = slug.strip("-")[:40] or "imagine"
    unique = re.sub(r"[^a-z0-9]", "", (suffix or uuid4().hex[:6]).lower())[:8] or "x"
    part = f"-{index + 1}" if index > 0 else ""
    clean_ext = str(ext or "png").lower().lstrip(".")
    return f"{slug}{part}-{unique}.{clean_ext}"


def unique_path(dest_dir: Path, filename: str) -> Path:
    dest_dir.mkdir(parents=True, exist_ok=True)
    safe = Path(filename).name or "imagine.bin"
    dest = dest_dir / safe
    if not dest.exists():
        return dest
    stem = dest.stem
    suffix = dest.suffix
    n = 2
    while True:
        candidate = dest_dir / f"{stem}_{n}{suffix}"
        if not candidate.exists():
            return candidate
        n += 1


def formats_from_query(query: str) -> dict[str, bool]:
    text = str(query or "").lower()
    mentioned = {
        "stl": bool(re.search(r"\bstl\b", text)),
        "glb": bool(re.search(r"\bglb\b|\bgltf\b", text)),
        "step": bool(re.search(r"\bstep\b|\bstp\b", text)),
        "3mf": bool(re.search(r"\b3mf\b", text)),
    }
    if not any(mentioned.values()):
        return {"stl": True, "glb": True, "step": True, "3mf": False}
    return mentioned


def normalize_formats(formats: dict[str, Any] | None, query: str = "") -> dict[str, bool]:
    if not formats:
        return formats_from_query(query)
    return {
        "stl": bool(formats.get("stl")),
        "glb": bool(formats.get("glb")),
        "step": bool(formats.get("step")),
        "3mf": bool(formats.get("3mf")),
    }


def suffix_allowed(suffix: str, formats: dict[str, bool]) -> bool:
    ext = str(suffix or "").lower()
    if ext == ".stp":
        return bool(formats.get("step"))
    if ext == ".gltf":
        return bool(formats.get("glb"))
    if ext == ".zip":
        return True
    key = ext.lstrip(".")
    return bool(formats.get(key))


def openai_models(speed: str = "fast") -> tuple[str, ...]:
    if str(speed or "").lower() == "quality":
        return OPENAI_IMAGINE_QUALITY_MODELS
    return OPENAI_IMAGINE_MODELS


def list_imagine_files(project_path: Path) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    root = Path(project_path) / IMAGINE_DIRNAME
    if not root.is_dir():
        return items
    files: list[tuple[float, Path]] = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if is_imagine_sidecar_name(path.name):
            continue
        try:
            files.append((path.stat().st_mtime, path))
        except OSError:
            continue
    files.sort(key=lambda row: row[0], reverse=True)
    for mtime, path in files:
        rel = path.relative_to(project_path).as_posix()
        suffix = path.suffix.lower()
        kind = "image" if suffix in cad_service.REFERENCE_IMAGE_SUFFIXES else "cad"
        meta = read_imagine_meta(path)
        label = str(meta.get("label") or "").strip() or path.name
        items.append(
            {
                "id": path.stem,
                "name": rel,
                "stem": path.stem,
                "format": suffix.lstrip("."),
                "kind": kind,
                "size": path.stat().st_size,
                "mtime": mtime,
                "url": rel,
                "section": "imagine",
                "folder": IMAGINE_DIRNAME,
                "label": label,
                "prompt": str(meta.get("prompt") or ""),
                "original_prompt": str(meta.get("original_prompt") or ""),
                "prompt_improved": bool(meta.get("prompt_improved")),
                "provider": str(meta.get("provider") or ""),
                "model": str(meta.get("model") or ""),
                "cost_usd": meta.get("cost_usd"),
            }
        )
    return items


def _extract_image_b64(response: Any) -> str | None:
    data = getattr(response, "data", None) or []
    if not data:
        return None
    first = data[0]
    return getattr(first, "b64_json", None) or (first.get("b64_json") if isinstance(first, dict) else None)


def generate_provider_image(client: Any, prompt: str, *, provider: str, speed: str = "fast") -> tuple[bytes, str]:
    last_err: Exception | None = None
    models = GROK_IMAGINE_MODELS if provider == "xai" else openai_models(speed)
    quality = "high" if str(speed or "").lower() == "quality" else "medium"
    for model in models:
        for size in ("1024x1024", "1536x1024"):
            try:
                response = client.images.generate(
                    model=model,
                    prompt=prompt,
                    size=size,
                    quality=quality,
                    output_format="png",
                )
            except TypeError:
                try:
                    response = client.images.generate(model=model, prompt=prompt, n=1)
                except Exception as exc:
                    last_err = exc
                    continue
            except Exception as exc:
                last_err = exc
                continue
            b64 = _extract_image_b64(response)
            if not b64:
                last_err = RuntimeError("Image API returned no image")
                continue
            import base64

            return base64.b64decode(b64), model
    if last_err:
        raise last_err
    raise RuntimeError("Image API returned no image")


def edit_provider_image(client: Any, prompt: str, image_bytes: bytes, *, provider: str, speed: str = "fast") -> tuple[bytes, str]:
    import base64

    last_err: Exception | None = None
    models = GROK_IMAGINE_MODELS if provider == "xai" else openai_models(speed)
    buf = io.BytesIO(image_bytes)
    buf.name = "imagine-edit.png"
    for model in models:
        try:
            response = client.images.edit(model=model, image=buf, prompt=prompt)
        except Exception as exc:
            last_err = exc
            buf.seek(0)
            continue
        b64 = _extract_image_b64(response)
        if not b64:
            last_err = RuntimeError("Image edit returned no image")
            buf.seek(0)
            continue
        return base64.b64decode(b64), model
    if last_err:
        raise last_err
    raise RuntimeError("Image edit returned no image")


def write_imagine_image(
    project_path: Path,
    image_bytes: bytes,
    prompt: str,
    *,
    index: int = 0,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    dest = unique_path(imagine_dir(project_path), filename_from_prompt(prompt, index=index, ext="png"))
    dest.write_bytes(image_bytes)
    rel = dest.relative_to(project_path).as_posix()
    label = sanitize_imagine_label(str(prompt or "").split("\n", 1)[0]) or dest.stem
    payload: dict[str, Any] = {"prompt": str(prompt or "").strip(), "label": label}
    if extra:
        for key in ("original_prompt", "prompt_improved", "provider", "model", "cost_usd"):
            if key in extra and extra[key] is not None:
                payload[key] = extra[key]
    write_imagine_meta(dest, payload)
    return {
        "name": rel,
        "filename": rel,
        "url": rel,
        "kind": "image",
        "format": "png",
        "section": "imagine",
        "folder": IMAGINE_DIRNAME,
        "label": label,
        "prompt": str(prompt or "").strip(),
        "original_prompt": str(payload.get("original_prompt") or ""),
        "prompt_improved": bool(payload.get("prompt_improved")),
        "provider": payload.get("provider") or "",
        "model": payload.get("model") or "",
        "cost_usd": payload.get("cost_usd"),
    }


def _safe_download(url: str, dest: Path) -> None:
    from urllib.parse import urlparse

    clean = url_document_service.clean_url(url)
    if not clean:
        raise RuntimeError("Blocked or invalid download URL.")
    suffix = Path(urlparse(clean).path).suffix.lower()
    if suffix not in FETCH_CAD_SUFFIXES | FETCH_ARCHIVE_SUFFIXES:
        raise RuntimeError(f"Refusing download of {suffix or 'unknown'} — CAD/mesh types only.")
    part_profiles_service.download_asset(clean, dest, timeout=60.0)
    if dest.stat().st_size > FETCH_MAX_BYTES:
        dest.unlink(missing_ok=True)
        raise RuntimeError("Download exceeded the CAD size limit.")


def _extract_zip(archive: Path, dest_dir: Path, formats: dict[str, bool]) -> list[Path]:
    saved: list[Path] = []
    with zipfile.ZipFile(archive) as zf:
        for info in zf.infolist():
            if info.is_dir() or ".." in info.filename.replace("\\", "/"):
                continue
            name = Path(info.filename).name
            suffix = Path(name).suffix.lower()
            if suffix not in FETCH_CAD_SUFFIXES or not suffix_allowed(suffix, formats):
                continue
            out = unique_path(dest_dir, name)
            out.write_bytes(zf.read(info))
            saved.append(out)
    archive.unlink(missing_ok=True)
    return saved


def fetch_public_models(project_path: Path, query: str, formats: dict[str, bool] | None = None) -> dict[str, Any]:
    """Download public CAD via pasted URLs and the step.parts catalog (no scrapers)."""
    wanted = normalize_formats(formats, query)
    dest_dir = imagine_fetched_dir(project_path)
    saved: list[Path] = []
    sources: list[str] = []
    errors: list[str] = []

    urls = url_document_service.urls_from_text(query, limit=4)
    for url in urls:
        try:
            from urllib.parse import urlparse

            suffix = Path(urlparse(url).path).suffix.lower()
            if suffix not in FETCH_CAD_SUFFIXES | FETCH_ARCHIVE_SUFFIXES:
                errors.append("Skipped a URL that was not a CAD file.")
                continue
            if suffix != ".zip" and not suffix_allowed(suffix, wanted):
                continue
            dest = unique_path(dest_dir, filename_from_prompt(query, ext=suffix.lstrip(".") or "bin"))
            _safe_download(url, dest)
            sources.append("url")
            if dest.suffix.lower() == ".zip":
                saved.extend(_extract_zip(dest, dest_dir, wanted))
            else:
                saved.append(dest)
        except Exception as exc:
            errors.append(str(exc))

    try:
        candidates = part_profiles_service.search_sources(query, limit=4)
    except RuntimeError as exc:
        candidates = []
        errors.append(str(exc))

    for item in candidates:
        if not item.get("is_real_result") and not item.get("step_url") and not item.get("glb_url"):
            continue
        downloads = []
        if wanted.get("step") and item.get("step_url"):
            downloads.append((item["step_url"], "step"))
        if wanted.get("glb") and item.get("glb_url"):
            downloads.append((item["glb_url"], "glb"))
        for url, ext in downloads:
            try:
                dest = unique_path(
                    dest_dir,
                    filename_from_prompt(item.get("name") or query, ext=ext),
                )
                _safe_download(url, dest)
                saved.append(dest)
                sources.append("step.parts")
            except Exception as exc:
                errors.append(str(exc))
        if saved:
            break

    files = []
    for path in saved:
        rel = path.relative_to(project_path).as_posix()
        files.append(
            {
                "name": rel,
                "filename": rel,
                "url": rel,
                "kind": "cad",
                "format": path.suffix.lower().lstrip("."),
                "section": "imagine",
                "folder": f"{IMAGINE_DIRNAME}/{IMAGINE_FETCHED_DIRNAME}",
                "source": "step.parts" if "step.parts" in sources else "url",
            }
        )
    if not files:
        message = "Nothing found on step.parts or a public CAD URL. Paste a direct .step / .stl / .glb link, or try a more specific catalog name."
        if errors:
            message = f"{message} {errors[0]}"
        return {"files": [], "message": message, "sources": sources, "errors": errors}
    used = ", ".join(sorted(set(sources))) or "catalog"
    return {
        "files": files,
        "message": f"Saved {len(files)} file(s) to {IMAGINE_DIRNAME}/{IMAGINE_FETCHED_DIRNAME}/ via {used}.",
        "sources": sources,
        "errors": errors,
    }
