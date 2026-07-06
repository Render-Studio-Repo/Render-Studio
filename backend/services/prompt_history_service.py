"""Per-project AI prompt history (separate from mesh timeline)."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.services import history_service
from backend.services.ai_cost import (
    dedupe_prompt_entries,
    entry_effective_cost,
    estimate_cost_usd,
    summarize_entries,
)

HISTORY_FILE = "prompt_history.json"
MAX_ENTRIES = 200

PRICING_REFRESH_PREFIXES = (
    "gpt-5.5-pro",
    "gpt-5.5",
    "gpt-5.3-codex",
    "claude-opus-4-8",
    "claude-opus-4-7",
    "claude-4.6-opus",
    "claude-opus-4-6",
    "claude-opus-4-5",
    "claude-4.6-sonnet",
    "claude-sonnet-4-6",
    "claude-sonnet-4-5",
    "claude-haiku-4-5",
)


def _path(project_path: Path) -> Path:
    return project_path / HISTORY_FILE


def load(project_path: Path) -> dict[str, Any]:
    path = _path(project_path)
    if not path.is_file():
        return {"entries": []}
    return json.loads(path.read_text())


def save(project_path: Path, data: dict[str, Any]) -> None:
    _path(project_path).write_text(json.dumps(data, indent=2), encoding="utf-8")


def append_entry(
    project_path: Path,
    *,
    prompt: str,
    success: bool,
    message: str | None = None,
    filename: str | None = None,
    base_filename: str | None = None,
    speed: str = "fast",
    error: str | None = None,
    references: list[dict[str, Any]] | None = None,
    images: list[dict[str, Any]] | None = None,
    trace_id: str | None = None,
    user_id: str | None = None,
    user_name: str | None = None,
    kind: str = "cad",
    usage: dict[str, Any] | None = None,
    cost_usd: float | None = None,
    ai_calls: int | None = None,
    model: str | None = None,
    provider: str | None = None,
    key_source: str | None = None,
    shared_key_id: str | None = None,
    shared_key_name: str | None = None,
    shared_by_name: str | None = None,
    prompt_mode: str | None = None,
) -> dict[str, Any]:
    data = load(project_path)
    entries: list[dict[str, Any]] = data.get("entries", [])
    entry = {
        "id": str(uuid.uuid4())[:10],
        "prompt": prompt,
        "success": success,
        "message": message,
        "filename": filename,
        "base_filename": base_filename,
        "speed": speed,
        "error": error,
        "reference_count": len(references or []),
        "image_count": len(images or []),
        "images": [
            {
                "id": img.get("id"),
                "name": img.get("name"),
                "media_type": img.get("media_type"),
            }
            for img in (images or [])[:4]
        ],
        "trace_id": trace_id,
        "user_id": user_id,
        "user_name": user_name,
        "kind": kind,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    if prompt_mode:
        entry["prompt_mode"] = str(prompt_mode).lower()
    if usage:
        entry["usage"] = usage
    if cost_usd is not None:
        entry["cost_usd"] = round(float(cost_usd), 6)
    elif usage:
        inferred = estimate_cost_usd(model, usage, provider=provider or "openai")
        if inferred is not None:
            entry["cost_usd"] = round(inferred, 6)
    if ai_calls is not None:
        entry["ai_calls"] = int(ai_calls)
    if model:
        entry["model"] = model
    if provider:
        entry["provider"] = provider
    if key_source:
        entry["key_source"] = key_source
    if shared_key_id:
        entry["shared_key_id"] = shared_key_id
    if shared_key_name:
        entry["shared_key_name"] = shared_key_name
    if shared_by_name:
        entry["shared_by_name"] = shared_by_name
    entries.append(entry)
    data["entries"] = entries[-MAX_ENTRIES:]
    save(project_path, data)
    return entry


def get_entry(project_path: Path, prompt_id: str) -> dict[str, Any] | None:
    data = load(project_path)
    for entry in data.get("entries", []):
        if entry.get("id") == prompt_id:
            return entry
    return None


def _entry_matches_base_filename(entry: dict[str, Any], base_filename: str) -> bool:
    if not base_filename:
        return True
    if entry.get("base_filename") == base_filename or entry.get("filename") == base_filename:
        return True
    if not entry.get("base_filename") and not entry.get("filename"):
        return True
    stem = Path(base_filename).stem
    entry_stem = Path(entry.get("filename") or entry.get("base_filename") or "").stem
    if stem and entry_stem and (stem.startswith(entry_stem) or entry_stem.startswith(stem)):
        return True
    return False


def _parse_time(raw: Any) -> datetime | None:
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _prompt_key(prompt: str) -> str:
    return (prompt or "")[:320]


def _has_billed_sibling(entries: list[dict[str, Any]], prompt: str) -> bool:
    key = _prompt_key(prompt)
    for entry in entries:
        if _prompt_key(entry.get("prompt") or "") != key:
            continue
        if entry_effective_cost(entry) is not None or entry.get("usage"):
            return True
    return False


def _backfill_from_timeline(project_path: Path) -> None:
    """Import legacy prompt steps from timeline.json when missing from prompt_history."""
    data = load(project_path)
    entries: list[dict[str, Any]] = list(data.get("entries", []))
    existing_ids = {e.get("id") for e in entries if e.get("id")}
    existing_traces = {str(e.get("trace_id")) for e in entries if e.get("trace_id")}
    timeline = history_service.load_timeline(project_path)
    imported: list[dict[str, Any]] = []
    for e in timeline.get("entries", []):
        if e.get("kind") != "prompt":
            continue
        entry_id = e.get("id")
        if entry_id and entry_id in existing_ids:
            continue
        meta = e.get("meta") or {}
        prompt = meta.get("prompt") or ""
        if not prompt and e.get("label", "").startswith("AI: "):
            prompt = e["label"][4:].rstrip("…")
        if not prompt:
            continue
        if _has_billed_sibling(entries, prompt):
            continue
        trace_id = meta.get("trace_id")
        if trace_id and str(trace_id) in existing_traces:
            continue
        usage = meta.get("usage") or meta.get("ai_usage")
        row: dict[str, Any] = {
            "id": entry_id or str(uuid.uuid4())[:10],
            "prompt": prompt,
            "success": True,
            "message": meta.get("message"),
            "filename": e.get("filename"),
            "base_filename": meta.get("base_filename") or meta.get("base"),
            "speed": meta.get("speed", "fast"),
            "error": None,
            "reference_count": len(meta.get("references") or []),
            "trace_id": trace_id,
            "user_id": e.get("user_id"),
            "user_name": e.get("user_name"),
            "kind": meta.get("kind") or "cad",
            "created_at": e.get("created_at") or datetime.now(timezone.utc).isoformat(),
            "recovered_from_timeline": True,
        }
        if usage:
            row["usage"] = usage
        if meta.get("cost_usd") is not None:
            row["cost_usd"] = meta.get("cost_usd")
        elif meta.get("model"):
            row["model"] = meta.get("model")
            row["provider"] = meta.get("provider") or "openai"
        imported.append(row)
    if imported:
        merged = entries + imported
        merged.sort(key=lambda x: x.get("created_at") or "")
        data["entries"] = merged[-MAX_ENTRIES:]
        save(project_path, data)


def _best_generated_filename(project_path: Path, started_at: str | None) -> str | None:
    from backend.services import cad_service

    started = _parse_time(started_at)
    candidates: list[tuple[int, float, str]] = []
    for info in cad_service.list_project_files(project_path):
        name = info.get("name") or ""
        path = project_path / name
        if not path.is_file() or path.suffix.lower() not in {".glb", ".gltf"}:
            continue
        try:
            mtime = path.stat().st_mtime
        except OSError:
            continue
        if started and datetime.fromtimestamp(mtime, tz=timezone.utc) < started:
            continue
        lowered = name.lower()
        score = 0
        if "_cleaned" in lowered:
            score -= 50
        if any(part in lowered for part in ("_base_", "_column", "_canister", "_knob", "_shaft", "_shelf")):
            score -= 10
        if "assembly" in lowered or "appliance" in lowered:
            score += 20
        score += min(int(info.get("size") or 0) // 100_000, 20)
        candidates.append((score, mtime, name))
    if not candidates:
        return None
    candidates.sort(reverse=True)
    return candidates[0][2]


def _backfill_from_generation(project_path: Path) -> None:
    """Recover prompt-history rows from generation.json when a worker missed save."""
    from backend.services import generation_service

    gen = generation_service.load(project_path)
    if not gen or gen.get("kind") != "prompt" or not gen.get("prompt"):
        return

    data = load(project_path)
    entries: list[dict[str, Any]] = data.get("entries", [])
    trace_id = gen.get("trace_id")
    if trace_id and any(str(e.get("trace_id")) == str(trace_id) for e in entries):
        return
    if _has_billed_sibling(entries, gen.get("prompt") or ""):
        return

    filename = gen.get("filename")
    if filename and not (project_path / str(filename)).is_file():
        filename = None
    recovered_filename = filename or _best_generated_filename(project_path, gen.get("started_at"))
    status = gen.get("status")
    success = status == "complete" or bool(recovered_filename and status in {"running", None})
    if status == "running" and not recovered_filename:
        return

    row: dict[str, Any] = {
        "id": str(gen.get("prompt_id") or str(uuid.uuid4())[:10]),
        "prompt": gen.get("prompt") or "",
        "success": bool(success),
        "message": gen.get("message"),
        "filename": recovered_filename if success else filename,
        "base_filename": gen.get("base_filename"),
        "speed": gen.get("speed", "fast"),
        "error": None if success else gen.get("error"),
        "reference_count": int(gen.get("reference_count") or 0),
        "image_count": int(gen.get("image_count") or 0),
        "images": gen.get("images") or [],
        "trace_id": trace_id,
        "user_id": gen.get("by_user_id"),
        "user_name": gen.get("by_user_name"),
        "kind": "cad",
        "created_at": gen.get("started_at") or datetime.now(timezone.utc).isoformat(),
        "recovered": True,
    }
    if gen.get("mode"):
        row["prompt_mode"] = str(gen.get("mode")).lower()
    if gen.get("usage"):
        row["usage"] = gen["usage"]
    if gen.get("cost_usd") is not None:
        row["cost_usd"] = gen.get("cost_usd")
    entries.append(row)
    data["entries"] = entries[-MAX_ENTRIES:]
    save(project_path, data)


def _enrich_entries(entries: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], bool]:
    """Fill missing cost_usd from token usage and drop duplicate recovery rows."""
    changed = False
    enriched: list[dict[str, Any]] = []
    for entry in entries:
        row = dict(entry)
        if row.get("usage"):
            inferred = estimate_cost_usd(
                row.get("model"),
                row.get("usage"),
                provider=row.get("provider") or "openai",
            )
            model = str(row.get("model") or "").lower()
            should_refresh = row.get("cost_usd") is None or any(
                model.startswith(prefix) for prefix in PRICING_REFRESH_PREFIXES
            )
            if inferred is not None and should_refresh and row.get("cost_usd") != round(inferred, 6):
                row["cost_usd"] = round(inferred, 6)
                changed = True
        enriched.append(row)
    deduped = dedupe_prompt_entries(enriched)
    if len(deduped) != len(enriched):
        changed = True
    return deduped, changed


def _fill_prompt_mode_from_generation(project_path: Path, entries: list[dict[str, Any]]) -> bool:
    """Backfill prompt_mode on history rows from generation.json when trace matches."""
    from backend.services import generation_service

    gen = generation_service.load(project_path) or {}
    gen_trace = str(gen.get("trace_id") or "")
    gen_mode = gen.get("mode")
    if not gen_trace or not gen_mode:
        return False
    changed = False
    for row in entries:
        if row.get("prompt_mode"):
            continue
        if str(row.get("trace_id") or "") == gen_trace:
            row["prompt_mode"] = str(gen_mode).lower()
            changed = True
    return changed


def _prepare_entries(project_path: Path, *, persist: bool = True) -> list[dict[str, Any]]:
    _backfill_from_timeline(project_path)
    _backfill_from_generation(project_path)
    data = load(project_path)
    entries, changed = _enrich_entries(data.get("entries", []))
    if _fill_prompt_mode_from_generation(project_path, entries):
        changed = True
    if persist and changed:
        data["entries"] = entries[-MAX_ENTRIES:]
        save(project_path, data)
    return entries


def list_entries(
    project_path: Path,
    *,
    limit: int = 80,
    base_filename: str | None = None,
    kind: str | None = None,
) -> list[dict[str, Any]]:
    entries = _prepare_entries(project_path)
    if kind:
        entries = [e for e in entries if (e.get("kind") or "cad") == kind]
    if base_filename:
        entries = [e for e in entries if _entry_matches_base_filename(e, base_filename)]
    return list(reversed(entries[-limit:]))


def project_usage_summary(project_path: Path, *, kind: str | None = None) -> dict[str, Any]:
    """Token/cost totals for prompts stored in this project."""
    entries = _prepare_entries(project_path)
    if kind:
        entries = [e for e in entries if (e.get("kind") or "cad") == kind]
    return summarize_entries(entries)


def workspace_usage_summary(
    project_paths: list[Path],
    *,
    kind: str | None = None,
    year: int | None = None,
    month: int | None = None,
) -> dict[str, Any]:
    """Aggregate prompt usage across many projects (e.g. workspace or all user projects)."""
    from backend.services.ai_cost import filter_entries_for_month, month_label

    combined: list[dict[str, Any]] = []
    seen_projects: set[str] = set()
    for path in project_paths:
        if not path.is_dir():
            continue
        seen_projects.add(path.name)
        entries = _prepare_entries(path)
        if kind:
            entries = [e for e in entries if (e.get("kind") or "cad") == kind]
        combined.extend(entries)
    if year is not None and month is not None:
        combined = filter_entries_for_month(combined, year, month)
    summary = summarize_entries(combined)
    summary["project_count"] = len(seen_projects)
    if year is not None and month is not None:
        summary["month"] = f"{year:04d}-{month:02d}"
        summary["month_label"] = month_label(year, month)
    return summary
