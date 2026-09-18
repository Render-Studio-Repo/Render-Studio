"""Safe file resolution for committed sandbox session assets."""

from __future__ import annotations

from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parent.parent.parent
SANDBOX_ROOT = ROOT / "sandbox-sessions"


def _safe_name(value: str, *, field: str) -> str:
    text = str(value or "").strip()
    if not text or text in {".", ".."}:
        raise ValueError(f"Invalid {field}.")
    if "/" in text or "\\" in text:
        raise ValueError(f"Invalid {field}.")
    return text


def resolve_asset(session_id: str, filename: str) -> Path:
    safe_session = _safe_name(session_id, field="session id")
    rel = PurePosixPath("/" + str(filename or "").lstrip("/")).relative_to("/")
    if not rel.parts or any(part in {"", ".", ".."} for part in rel.parts):
        raise ValueError("Invalid asset path.")
    base = (SANDBOX_ROOT / safe_session).resolve()
    target = (base / Path(*rel.parts)).resolve()
    try:
        target.relative_to(base)
    except ValueError as exc:
        raise ValueError("Invalid asset path.") from exc
    if not target.is_file():
        raise FileNotFoundError(f"Sandbox asset not found: {rel.as_posix()}")
    return target
