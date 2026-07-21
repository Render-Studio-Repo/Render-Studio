"""Per-project AI prompt history (separate from mesh timeline)."""

from __future__ import annotations

import json
import re
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

# Legacy name kept for imports; cost refresh now applies to every model with usage.
PRICING_REFRESH_PREFIXES: tuple[str, ...] = ()


def _safe_history_references(references: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    safe_refs: list[dict[str, Any]] = []
    for ref in (references or [])[:20]:
        if not isinstance(ref, dict):
            continue
        item: dict[str, Any] = {}
        for key in (
            "id",
            "type",
            "label",
            "token",
            "filename",
            "stem",
            "format",
            "viewer_filename",
            "projectId",
            "body_index",
            "body_name",
            "component_index",
            "component_name",
            "source_filename",
            "parent_filename",
            "kind",
            "wire_id",
            "endpoints",
            "from",
            "to",
            "color",
        ):
            value = ref.get(key)
            if value is not None:
                item[key] = value
        if ref.get("text_content") and str(ref.get("type") or "").lower() in {"dxf", "document", "text", "spec"}:
            text = str(ref.get("text_content") or "")
            item["text_content"] = text[:100_000]
            item["text_truncated"] = bool(ref.get("text_truncated") or len(text) > 100_000)
        if item:
            safe_refs.append(item)
    return safe_refs


def _path(project_path: Path) -> Path:
    return project_path / HISTORY_FILE


def load(project_path: Path) -> dict[str, Any]:
    path = _path(project_path)
    if not path.is_file():
        return {"entries": []}
    try:
        raw = path.read_text()
        if not raw.strip():
            return {"entries": []}
        return json.loads(raw)
    except (OSError, json.JSONDecodeError):
        return {"entries": []}


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
    user_avatar_url: str | None = None,
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
    original_prompt: str | None = None,
    prompt_improved: bool | None = None,
    target_mode: str | None = None,
    codex_agent: bool | None = None,
    skills: list[str] | None = None,
    entry_id: str | None = None,
    status: str | None = None,
) -> dict[str, Any]:
    data = load(project_path)
    entries: list[dict[str, Any]] = data.get("entries", [])
    id_match_at: int | None = None
    if entry_id:
        for i, existing in enumerate(entries):
            if existing.get("id") == entry_id:
                id_match_at = i
                break
    upsert_at = id_match_at
    if upsert_at is None:
        upsert_at = _find_upsert_index(
            entries,
            entry_id=None,
            trace_id=trace_id,
            prompt=prompt,
            original_prompt=original_prompt,
        )
    if id_match_at is not None:
        keep_id = entry_id
    elif upsert_at is not None:
        # Resume matched an interrupt stub — keep that @prompt id so the user does not lose their place.
        keep_id = entries[upsert_at].get("id") or entry_id or str(uuid.uuid4())[:10]
    else:
        keep_id = entry_id or str(uuid.uuid4())[:10]
    keep_created = (
        entries[upsert_at].get("created_at")
        if upsert_at is not None
        else datetime.now(timezone.utc).isoformat()
    )
    entry = {
        "id": str(keep_id),
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
        "user_avatar_url": user_avatar_url,
        "kind": kind,
        "created_at": keep_created,
    }
    normalized_status = str(status or "").strip().lower()
    if normalized_status:
        entry["status"] = normalized_status
    safe_refs = _safe_history_references(references)
    if safe_refs:
        entry["references"] = safe_refs
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
    original = str(original_prompt or "").strip()
    if original and original != str(prompt or "").strip():
        entry["original_prompt"] = original
        entry["prompt_improved"] = True
    elif prompt_improved:
        entry["prompt_improved"] = True
        if original:
            entry["original_prompt"] = original
    normalized_target = str(target_mode or "").strip().lower()
    if normalized_target not in {"new", "edit"}:
        normalized_target = "edit" if base_filename else "new"
    entry["target_mode"] = normalized_target
    if codex_agent:
        entry["codex_agent"] = True
    normalized_skills = []
    seen_skills = set()
    for skill in skills or []:
        skill_id = str(skill or "").strip().lower()
        if not skill_id or skill_id in seen_skills:
            continue
        normalized_skills.append(skill_id)
        seen_skills.add(skill_id)
    if normalized_skills:
        entry["skills"] = normalized_skills[:20]
    if upsert_at is not None:
        # Resume / retry completed — replace the interrupt stub in place.
        entry.pop("recovered", None)
        entry.pop("interrupted", None)
        entries[upsert_at] = entry
    else:
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

    def _norm_stem(name: str) -> str:
        stem = Path(name or "").stem
        # Viewer sidecars like ".Foo.step.glb" / "Foo.step.glb" → "Foo"
        while stem.lower().endswith(".step") or stem.lower().endswith(".stp"):
            stem = Path(stem).stem
        return stem.lstrip(".")

    stem = _norm_stem(base_filename)
    entry_stem = _norm_stem(entry.get("filename") or entry.get("base_filename") or "")
    if stem and entry_stem and (stem == entry_stem or stem.startswith(entry_stem) or entry_stem.startswith(stem)):
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


def _is_server_update_error(message: str | None) -> bool:
    return bool(
        re.search(
            r"stopped during a server update|interrupted by server restart|Generation interrupted by server",
            str(message or ""),
            re.IGNORECASE,
        )
    )


def _entry_prompt_keys(entry: dict[str, Any]) -> set[str]:
    keys = {
        _prompt_key(entry.get("prompt") or ""),
        _prompt_key(entry.get("original_prompt") or ""),
    }
    return {k for k in keys if k}


def _is_interrupt_stub(entry: dict[str, Any]) -> bool:
    if entry.get("success") is not False:
        return False
    if entry.get("recovered") or entry.get("interrupted"):
        return True
    return _is_server_update_error(entry.get("error"))


def _find_upsert_index(
    entries: list[dict[str, Any]],
    *,
    entry_id: str | None = None,
    trace_id: str | None = None,
    prompt: str | None = None,
    original_prompt: str | None = None,
) -> int | None:
    """Prefer updating an existing row (same id/trace, or interrupt stub) in place."""
    if entry_id:
        for i, entry in enumerate(entries):
            if entry.get("id") == entry_id:
                return i
    if trace_id:
        for i, entry in enumerate(entries):
            if str(entry.get("trace_id") or "") == str(trace_id):
                return i
    keys = {_prompt_key(prompt or ""), _prompt_key(original_prompt or "")} - {""}
    if not keys:
        return None
    for i in range(len(entries) - 1, -1, -1):
        entry = entries[i]
        if not _is_interrupt_stub(entry):
            continue
        if keys & _entry_prompt_keys(entry):
            return i
    return None


def _has_billed_sibling(entries: list[dict[str, Any]], prompt: str) -> bool:
    key = _prompt_key(prompt)
    for entry in entries:
        if key not in _entry_prompt_keys(entry):
            continue
        if entry_effective_cost(entry) is not None or entry.get("usage"):
            return True
    return False


def _merge_usage_from_timeline(project_path: Path, entries: list[dict[str, Any]]) -> bool:
    """Patch prompt_history rows that are missing usage when timeline has the same trace_id."""
    timeline = history_service.load_timeline(project_path)
    by_trace: dict[str, dict[str, Any]] = {}
    for e in timeline.get("entries", []):
        if e.get("kind") != "prompt":
            continue
        meta = e.get("meta") or {}
        trace_id = meta.get("trace_id")
        if not trace_id:
            continue
        usage = meta.get("usage") or meta.get("ai_usage")
        if not usage and meta.get("cost_usd") is None:
            continue
        by_trace[str(trace_id)] = meta

    changed = False
    for row in entries:
        if row.get("usage") and row.get("cost_usd") is not None:
            continue
        trace_id = row.get("trace_id")
        if not trace_id:
            continue
        meta = by_trace.get(str(trace_id))
        if not meta:
            continue
        usage = meta.get("usage") or meta.get("ai_usage")
        if usage and not row.get("usage"):
            row["usage"] = usage
            changed = True
        if meta.get("cost_usd") is not None and row.get("cost_usd") is None:
            row["cost_usd"] = meta.get("cost_usd")
            changed = True
        if meta.get("model") and not row.get("model"):
            row["model"] = meta.get("model")
            changed = True
        if meta.get("provider") and not row.get("provider"):
            row["provider"] = meta.get("provider")
            changed = True
        elif usage and not row.get("provider"):
            row["provider"] = "openai"
            changed = True
        if usage and row.get("cost_usd") is None:
            inferred = estimate_cost_usd(
                row.get("model"),
                row.get("usage"),
                provider=row.get("provider") or "openai",
            )
            if inferred is not None:
                row["cost_usd"] = round(inferred, 6)
                changed = True
    return changed


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
        safe_refs = _safe_history_references(meta.get("references") or [])
        if safe_refs:
            row["references"] = safe_refs
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


def _apply_job_usage_to_entry(entry: dict[str, Any], gen: dict[str, Any]) -> bool:
    """Copy usage/cost from a generation job onto a history row when missing or incomplete."""
    from backend.services.ai_cost import usage_fields_for_history
    from backend.services.generation_service import job_all_ai_traces

    changed = False
    usage_meta: dict[str, Any] = {}
    if gen.get("usage") or gen.get("cost_usd") is not None:
        for key in ("usage", "cost_usd", "ai_calls", "model", "provider"):
            if gen.get(key) is not None:
                usage_meta[key] = gen.get(key)
    else:
        combined = job_all_ai_traces(gen)
        if combined:
            usage_meta = usage_fields_for_history(combined)

    entry_tokens = int((entry.get("usage") or {}).get("total_tokens") or 0) or (
        int((entry.get("usage") or {}).get("input_tokens") or 0)
        + int((entry.get("usage") or {}).get("output_tokens") or 0)
    )
    job_tokens = int((usage_meta.get("usage") or {}).get("total_tokens") or 0) or (
        int((usage_meta.get("usage") or {}).get("input_tokens") or 0)
        + int((usage_meta.get("usage") or {}).get("output_tokens") or 0)
    )
    if usage_meta.get("usage") and job_tokens > entry_tokens:
        entry["usage"] = usage_meta["usage"]
        changed = True
    if usage_meta.get("cost_usd") is not None and (
        entry.get("cost_usd") is None or job_tokens > entry_tokens
    ):
        entry["cost_usd"] = usage_meta["cost_usd"]
        changed = True
    if usage_meta.get("ai_calls") is not None and entry.get("ai_calls") is None:
        entry["ai_calls"] = usage_meta["ai_calls"]
        changed = True
    for key in ("model", "provider"):
        if usage_meta.get(key) and not entry.get(key):
            entry[key] = usage_meta[key]
            changed = True
    return changed


def _row_from_generation_job(gen: dict[str, Any], project_path: Path) -> dict[str, Any] | None:
    """Build a recovered prompt-history row from one finished generation job."""
    from backend.services.ai_cost import usage_fields_for_history

    kind = str(gen.get("kind") or "prompt").lower()
    if kind not in {"prompt", "cad"}:
        return None
    request_body = gen.get("request_body") if isinstance(gen.get("request_body"), dict) else {}
    recovered_prompt = str(request_body.get("prompt") or gen.get("prompt") or "")
    if not recovered_prompt.strip():
        return None
    trace_id = gen.get("trace_id")
    if not trace_id:
        return None
    status = gen.get("status")
    if status == "running":
        return None
    if gen.get("benign_interrupt") or (
        status in {"canceled", "failed"} and _is_server_update_error(gen.get("error"))
    ):
        return None

    filename = gen.get("filename")
    if filename and not (project_path / str(filename)).is_file():
        filename = None
    recovered_filename = filename or _best_generated_filename(project_path, gen.get("started_at"))
    success = status == "complete" or bool(recovered_filename and status is None)

    recovered_speed = str(gen.get("speed") or request_body.get("speed") or "fast").lower()
    if recovered_speed not in {"fast", "quality"}:
        recovered_speed = "fast"
    row: dict[str, Any] = {
        "id": str(gen.get("prompt_id") or request_body.get("prompt_id") or str(uuid.uuid4())[:10]),
        "prompt": recovered_prompt,
        "success": bool(success),
        "message": gen.get("message"),
        "filename": recovered_filename if success else filename,
        "base_filename": gen.get("base_filename") or request_body.get("base_filename"),
        "speed": recovered_speed,
        "error": None if success else gen.get("error"),
        "reference_count": int(gen.get("reference_count") or len(request_body.get("references") or []) or 0),
        "image_count": int(gen.get("image_count") or len(request_body.get("images") or []) or 0),
        "images": gen.get("images") or [],
        "trace_id": trace_id,
        "user_id": gen.get("by_user_id"),
        "user_name": gen.get("by_user_name"),
        "kind": "cad",
        "created_at": gen.get("started_at") or datetime.now(timezone.utc).isoformat(),
        "recovered": True,
    }
    if status in {"canceled", "stopped"}:
        row["status"] = "stopped"
    elif status == "failed":
        row["status"] = "failed"
    mode = gen.get("mode") or request_body.get("mode")
    if mode:
        row["prompt_mode"] = str(mode).lower()
    usage_meta: dict[str, Any] = {}
    if gen.get("usage") or gen.get("cost_usd") is not None:
        for key in ("usage", "cost_usd", "ai_calls", "model", "provider"):
            if gen.get(key) is not None:
                usage_meta[key] = gen.get(key)
    else:
        from backend.services.generation_service import job_all_ai_traces

        combined = job_all_ai_traces(gen)
        if combined:
            usage_meta = usage_fields_for_history(combined)
    for key, value in usage_meta.items():
        if value is not None:
            row[key] = value
    if not row.get("model"):
        intended = str(request_body.get("model") or "").strip()
        if intended:
            row["model"] = intended
        provider_hint = str(request_body.get("provider") or "").strip()
        if provider_hint and not row.get("provider"):
            row["provider"] = provider_hint
    original = str(request_body.get("original_prompt") or "").strip()
    if original and original != recovered_prompt.strip():
        row["original_prompt"] = original
        row["prompt_improved"] = True
    elif request_body.get("prompt_improved"):
        row["prompt_improved"] = True
        if original:
            row["original_prompt"] = original
    target = str(request_body.get("target_mode") or "").strip().lower()
    if target not in {"new", "edit"}:
        target = "edit" if row.get("base_filename") else "new"
    row["target_mode"] = target
    if request_body.get("codex_agent") or request_body.get("jake_codex_agent") or gen.get("codex_agent"):
        row["codex_agent"] = True
    return row


def _backfill_from_generation(project_path: Path) -> None:
    """Recover prompt-history rows from generation.json when a worker missed save.

    Walks every finished job (not only the primary/composed one) and also patches
    existing history rows that are missing usage/cost still present on the job.
    """
    from backend.services import generation_service

    gen_doc = generation_service.load(project_path)
    if not gen_doc:
        return
    jobs = gen_doc.get("jobs") if isinstance(gen_doc.get("jobs"), list) else None
    if not jobs:
        jobs = [gen_doc]

    data = load(project_path)
    entries: list[dict[str, Any]] = data.get("entries", [])
    changed = False

    for gen in jobs:
        if not isinstance(gen, dict):
            continue
        trace_id = gen.get("trace_id")
        if not trace_id:
            continue
        existing = next((e for e in entries if str(e.get("trace_id") or "") == str(trace_id)), None)
        if existing is not None:
            if _apply_job_usage_to_entry(existing, gen):
                changed = True
            continue

        row = _row_from_generation_job(gen, project_path)
        if not row:
            continue
        recovered_prompt = str(row.get("prompt") or "")
        original = str(row.get("original_prompt") or "").strip()
        # Avoid inventing a second billed row for the same prompt text when usage
        # already landed on another entry — unless this job itself has usage to keep.
        if not (row.get("usage") or row.get("cost_usd") is not None) and (
            _has_billed_sibling(entries, recovered_prompt)
            or (original and _has_billed_sibling(entries, original))
        ):
            continue
        # prompt_id can be reused across retries; never collide with another trace's row.
        row_id = str(row.get("id") or "")
        if row_id and any(
            e.get("id") == row_id and str(e.get("trace_id") or "") != str(trace_id) for e in entries
        ):
            row["id"] = str(uuid.uuid4())[:10]
        entries.append(row)
        changed = True

    if changed:
        data["entries"] = entries[-MAX_ENTRIES:]
        save(project_path, data)


def _reconcile_interrupt_stubs(entries: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], bool]:
    """Fold later successes into interrupt stubs so the original @prompt id stays valid."""
    if not entries:
        return entries, False

    interrupt_idxs = [i for i, e in enumerate(entries) if _is_interrupt_stub(e)]
    if not interrupt_idxs:
        return entries, False

    drop: set[int] = set()
    changed = False
    for i in interrupt_idxs:
        stub = entries[i]
        stub_keys = _entry_prompt_keys(stub)
        if not stub_keys:
            continue
        match_j: int | None = None
        for j, entry in enumerate(entries):
            if j == i or j in drop:
                continue
            if entry.get("success") is False:
                continue
            if not (stub_keys & _entry_prompt_keys(entry)):
                continue
            match_j = j
            break
        if match_j is None:
            continue
        winner = dict(entries[match_j])
        winner["id"] = stub.get("id") or winner.get("id")
        winner["created_at"] = stub.get("created_at") or winner.get("created_at")
        winner.pop("recovered", None)
        winner.pop("interrupted", None)
        entries[i] = winner
        drop.add(match_j)
        changed = True

    if not drop:
        return entries, changed
    kept = [e for i, e in enumerate(entries) if i not in drop]
    return kept, True


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
            # Recompute from current pricing for every model (including future ids).
            should_refresh = True
            if inferred is not None and should_refresh and row.get("cost_usd") != round(inferred, 6):
                row["cost_usd"] = round(inferred, 6)
                changed = True
        target = str(row.get("target_mode") or "").strip().lower()
        if target not in {"new", "edit"}:
            inferred_target = "edit" if row.get("base_filename") else "new"
            if (row.get("kind") or "cad") == "cad":
                row["target_mode"] = inferred_target
                changed = True
        enriched.append(row)
    enriched, reconciled = _reconcile_interrupt_stubs(enriched)
    if reconciled:
        changed = True
    deduped = dedupe_prompt_entries(enriched)
    if len(deduped) != len(enriched):
        changed = True
    return deduped, changed


def _fill_prompt_mode_from_generation(project_path: Path, entries: list[dict[str, Any]]) -> bool:
    """Backfill prompt_mode / speed / improve metadata from generation.json when trace matches."""
    from backend.services import generation_service

    gen = generation_service.load(project_path) or {}
    gen_trace = str(gen.get("trace_id") or "")
    request_body = gen.get("request_body") if isinstance(gen.get("request_body"), dict) else {}
    gen_mode = gen.get("mode") or request_body.get("mode")
    gen_speed = gen.get("speed") or request_body.get("speed")
    if not gen_trace:
        return False
    changed = False
    for row in entries:
        if str(row.get("trace_id") or "") != gen_trace:
            continue
        if not row.get("prompt_mode") and gen_mode:
            row["prompt_mode"] = str(gen_mode).lower()
            changed = True
        if not row.get("speed") and gen_speed:
            speed = str(gen_speed).lower()
            if speed in {"fast", "quality"}:
                row["speed"] = speed
                changed = True
        original = str(request_body.get("original_prompt") or "").strip()
        if original and not row.get("original_prompt"):
            row["original_prompt"] = original
            changed = True
        if request_body.get("prompt_improved") and not row.get("prompt_improved"):
            row["prompt_improved"] = True
            changed = True
        elif original and original != str(row.get("prompt") or "").strip() and not row.get("prompt_improved"):
            row["prompt_improved"] = True
            changed = True
        full_prompt = str(request_body.get("prompt") or "").strip()
        if full_prompt and len(full_prompt) > len(str(row.get("prompt") or "")):
            row["prompt"] = full_prompt
            changed = True
        if not row.get("model") and gen.get("model"):
            row["model"] = gen.get("model")
            changed = True
        if not row.get("provider") and gen.get("provider"):
            row["provider"] = gen.get("provider")
            changed = True
        # Prefer explicit job/request target_mode; never demote a real edit to
        # "new" just because base_filename was temporarily null in older builds.
        target = str(
            gen.get("target_mode")
            or request_body.get("target_mode")
            or row.get("target_mode")
            or ""
        ).strip().lower()
        if target not in {"new", "edit"}:
            has_base = bool(row.get("base_filename") or request_body.get("base_filename") or gen.get("base_filename"))
            refs = request_body.get("references") or row.get("references") or []
            has_face = any(str((r or {}).get("type") or "").lower() == "face" for r in refs if isinstance(r, dict))
            has_component = any(
                str((r or {}).get("type") or "").lower() == "component" for r in refs if isinstance(r, dict)
            )
            target = "edit" if (has_base or (has_face and has_component)) else "new"
        if (row.get("kind") or "cad") == "cad" and row.get("target_mode") != target:
            row["target_mode"] = target
            changed = True
        # Recover missing base from face/component refs so history matches the edit.
        if not row.get("base_filename"):
            recovered_base = (
                request_body.get("base_filename")
                or gen.get("base_filename")
                or next(
                    (
                        (r or {}).get("filename")
                        for r in (request_body.get("references") or [])
                        if isinstance(r, dict)
                        and str(r.get("type") or "").lower() in {"component", "face"}
                        and r.get("filename")
                    ),
                    None,
                )
            )
            if recovered_base:
                row["base_filename"] = recovered_base
                changed = True
        if (
            request_body.get("codex_agent")
            or request_body.get("jake_codex_agent")
            or gen.get("codex_agent")
        ) and not row.get("codex_agent"):
            row["codex_agent"] = True
            changed = True
    return changed


def _prepare_entries(project_path: Path, *, persist: bool = True) -> list[dict[str, Any]]:
    _backfill_from_timeline(project_path)
    _backfill_from_generation(project_path)
    data = load(project_path)
    entries = list(data.get("entries", []))
    if _merge_usage_from_timeline(project_path, entries):
        data["entries"] = entries
        save(project_path, data)
    entries, changed = _enrich_entries(entries)
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
    user_id: str | None = None,
) -> dict[str, Any]:
    """Aggregate prompt usage across many projects (e.g. workspace or all user projects)."""
    from backend.services.ai_cost import entry_effective_cost, entry_in_month, filter_entries_for_month, month_label

    combined: list[dict[str, Any]] = []
    seen_projects: set[str] = set()
    projects_with_prompts: set[str] = set()
    for path in project_paths:
        if not path.is_dir():
            continue
        seen_projects.add(path.name)
        entries = _prepare_entries(path)
        if kind:
            entries = [e for e in entries if (e.get("kind") or "cad") == kind]
        if user_id:
            entries = [e for e in entries if e.get("user_id") == user_id]
        if entries:
            projects_with_prompts.add(path.name)
        combined.extend(entries)
    if year is not None and month is not None:
        combined = filter_entries_for_month(combined, year, month)
        if user_id or kind:
            projects_with_prompts = {
                path.name
                for path in project_paths
                if path.is_dir()
                and any(
                    entry_in_month(e, year, month)
                    and (not user_id or e.get("user_id") == user_id)
                    and (not kind or (e.get("kind") or "cad") == kind)
                    for e in _prepare_entries(path)
                )
            }
    summary = summarize_entries(combined)
    summary["project_count"] = len(seen_projects)
    summary["projects_with_prompts"] = len(projects_with_prompts)
    summary["ai_calls"] = sum(int(e.get("ai_calls") or 0) for e in combined if entry_effective_cost(e) is not None)
    if year is not None and month is not None:
        summary["month"] = f"{year:04d}-{month:02d}"
        summary["month_label"] = month_label(year, month)
    return summary
