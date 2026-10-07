"""Sandbox live token / prompt-trace status (read-only, deeper logs)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[2]
LIVE_PROMPTS = REPO / "data" / "prompt-trace" / "live-prompts.jsonl"

# Soft ceiling for rolling window estimate (chars/4). Above = HIGH.
HIGH_TOKENS = 48_000
WARN_TOKENS = 24_000


def _est_tokens(row: dict[str, Any]) -> int:
    if row.get("token_cost"):
        try:
            return max(0, int(row["token_cost"]))
        except (TypeError, ValueError):
            pass
    tin = int(row.get("tokens_in") or 0)
    tout = int(row.get("tokens_out") or 0)
    if tin or tout:
        return tin + tout
    blob = " ".join(
        str(row.get(k) or "")
        for k in ("prompt", "notes", "steps", "categories", "result")
    )
    return max(1, len(blob) // 4)


def _read_tail(path: Path, max_lines: int = 120) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []
    out: list[dict[str, Any]] = []
    for line in lines[-max_lines:]:
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(row, dict):
            out.append(row)
    return out


def token_status(*, limit: int = 60) -> dict[str, Any]:
    """Look further back in live-prompts — do not stop at the last 8 REPORT rows."""
    lim = max(12, min(int(limit or 60), 200))
    rows = _read_tail(LIVE_PROMPTS, max_lines=max(lim, 120))
    window = rows[-lim:]
    series = []
    for row in window:
        tok = _est_tokens(row)
        series.append(
            {
                "log_id": str(row.get("log_id") or "")[:64],
                "result": str(row.get("result") or "unknown")[:24],
                "score": row.get("score"),
                "tokens": tok,
                "at": str(row.get("timestamp") or "")[:40],
                "prompt": str(row.get("prompt") or "")[:80],
            }
        )
    total = sum(int(s["tokens"]) for s in series)
    peak = max((int(s["tokens"]) for s in series), default=0)
    high = total >= HIGH_TOKENS or peak >= (HIGH_TOKENS // 3)
    warn = (not high) and (total >= WARN_TOKENS or peak >= (WARN_TOKENS // 2))
    by_result: dict[str, int] = {}
    for s in series:
        by_result[s["result"]] = by_result.get(s["result"], 0) + 1
    return {
        "ok": True,
        "source": str(LIVE_PROMPTS.relative_to(REPO)) if LIVE_PROMPTS.is_file() else "missing",
        "lookback": len(series),
        "file_rows": len(rows),
        "tokens_total": total,
        "tokens_peak": peak,
        "high": high,
        "warn": warn,
        "threshold_high": HIGH_TOKENS,
        "threshold_warn": WARN_TOKENS,
        "by_result": by_result,
        "series": series,
        "note": "Estimate from prompt-trace live-prompts (token_cost or chars/4). Lookback deeper than REPORT board.",
    }
