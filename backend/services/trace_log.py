"""In-memory activity trace for debugging API and AI calls."""

from __future__ import annotations

import time
import uuid
from collections import deque
from datetime import datetime, timezone
from typing import Any

_MAX = 150
_entries: deque[dict[str, Any]] = deque(maxlen=_MAX)


def new_trace_id() -> str:
    return str(uuid.uuid4())[:8]


def add(
    level: str,
    message: str,
    *,
    trace_id: str | None = None,
    data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    entry = {
        "id": str(uuid.uuid4())[:10],
        "trace_id": trace_id,
        "ts": datetime.now(timezone.utc).isoformat(),
        "level": level,
        "message": message,
        "data": data or {},
    }
    _entries.appendleft(entry)
    return entry


def list_entries(limit: int = 80) -> list[dict[str, Any]]:
    return list(_entries)[:limit]


def clear() -> None:
    _entries.clear()


class TraceTimer:
    def __init__(self, label: str, trace_id: str) -> None:
        self.label = label
        self.trace_id = trace_id
        self._t0 = time.perf_counter()

    def done(self, **data: Any) -> float:
        ms = (time.perf_counter() - self._t0) * 1000
        add("info", f"{self.label} ({ms:.0f}ms)", trace_id=self.trace_id, data={"duration_ms": ms, **data})
        return ms
