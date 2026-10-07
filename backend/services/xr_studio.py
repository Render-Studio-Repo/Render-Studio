"""XR Studio payload helpers: usage totals match laptop prompt History."""

from __future__ import annotations

from pathlib import Path
from typing import Any


def token_count_from_entry(entry: dict[str, Any] | None) -> int:
    row = entry if isinstance(entry, dict) else {}
    usage = row.get("usage") if isinstance(row.get("usage"), dict) else {}
    meta = row.get("meta") if isinstance(row.get("meta"), dict) else {}
    nested = meta.get("usage") if isinstance(meta.get("usage"), dict) else {}
    for blob in (usage, nested, meta):
        for key in ("total_tokens", "tokens", "token_count"):
            try:
                n = int(blob.get(key) or 0)
            except (TypeError, ValueError):
                n = 0
            if n:
                return n
        try:
            inp = int(blob.get("input_tokens") or blob.get("prompt_tokens") or 0)
            out = int(blob.get("output_tokens") or blob.get("completion_tokens") or 0)
        except (TypeError, ValueError):
            inp = out = 0
        if inp or out:
            return inp + out
    return 0


def usage_from_prompt_history(project_path: Path) -> dict[str, Any]:
    from backend.services import prompt_history_service
    from backend.services.ai_cost import summarize_entries

    try:
        entries = prompt_history_service.list_entries(project_path, limit=200)
    except Exception:
        entries = []
    summary = summarize_entries(entries) if entries else {}
    usage_blob = summary.get("usage") if isinstance(summary.get("usage"), dict) else {}
    by_user: dict[str, dict[str, Any]] = {}
    queries = 0
    for e in entries:
        if str(e.get("status") or "").strip().lower() == "running":
            continue
        queries += 1
        who = str(e.get("user_name") or e.get("user_id") or "Someone")
        row = by_user.setdefault(who, {"name": who, "queries": 0, "tokens": 0})
        row["queries"] += 1
        row["tokens"] += token_count_from_entry(e)
    tokens = int(usage_blob.get("total_tokens") or 0)
    if not tokens:
        tokens = sum(r["tokens"] for r in by_user.values())
    return {
        "tokens": tokens,
        "queries": queries,
        "prompt_count": int(summary.get("prompt_count") or queries),
        "by_user": sorted(by_user.values(), key=lambda r: (-r["tokens"], -r["queries"], r["name"])),
    }


def merge_log_usage(usage: dict[str, Any], history: list[dict[str, Any]]) -> dict[str, Any]:
    """Fill zeros from the project History log when prompt-history has no usage yet."""
    out = {
        "tokens": int((usage or {}).get("tokens") or 0),
        "queries": int((usage or {}).get("queries") or 0),
        "by_user": list((usage or {}).get("by_user") or []),
    }
    if out["tokens"] and out["queries"]:
        return out
    by_user: dict[str, dict[str, Any]] = {r["name"]: dict(r) for r in out["by_user"] if r.get("name")}
    queries = 0
    tokens = 0
    for e in history or []:
        kind = str(e.get("kind") or "")
        who = str(e.get("user_name") or e.get("user_id") or "Someone")
        row = by_user.setdefault(who, {"name": who, "queries": 0, "tokens": 0})
        if kind in {"prompt", "build"}:
            row["queries"] += 1
            queries += 1
        n = token_count_from_entry(e)
        row["tokens"] += n
        tokens += n
    if not out["queries"]:
        out["queries"] = queries
    if not out["tokens"]:
        out["tokens"] = tokens
    if not out["by_user"]:
        out["by_user"] = sorted(by_user.values(), key=lambda r: (-r["tokens"], -r["queries"], r["name"]))
    return out
