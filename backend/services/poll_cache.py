"""TTL cache so leftover dashboard / studio tabs cannot saturate workers."""

from __future__ import annotations

import time
from typing import Any, Callable, TypeVar

_T = TypeVar("_T")
_store: dict[str, tuple[float, Any]] = {}


def get_or_set(key: str, ttl: float, factory: Callable[[], _T]) -> _T:
    now = time.monotonic()
    hit = _store.get(key)
    if hit and now - hit[0] < ttl:
        return hit[1]
    value = factory()
    _store[key] = (now, value)
    return value
