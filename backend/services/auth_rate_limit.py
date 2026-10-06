"""In-memory login / signup rate limit (no PII in keys)."""

from __future__ import annotations

import hashlib
import threading
import time
from collections import defaultdict, deque

_lock = threading.Lock()
_hits: dict[str, deque[float]] = defaultdict(deque)

IP_LIMIT = 12
EMAIL_LIMIT = 8
WINDOW_S = 60.0


def _prune(bucket: deque[float], now: float) -> None:
    while bucket and now - bucket[0] > WINDOW_S:
        bucket.popleft()


def _email_key(email: str) -> str:
    raw = (email or "").strip().lower().encode("utf-8")
    return "e:" + hashlib.sha256(raw).hexdigest()[:16]


def allow(*, ip: str, email: str = "", ip_limit: int = IP_LIMIT, email_limit: int = EMAIL_LIMIT) -> bool:
    """Return False when the caller should receive HTTP 429."""
    now = time.monotonic()
    ip_key = "ip:" + (ip or "unknown")
    keys = [ip_key]
    limits = {ip_key: ip_limit}
    if email.strip():
        ek = _email_key(email)
        keys.append(ek)
        limits[ek] = email_limit
    with _lock:
        for key in keys:
            bucket = _hits[key]
            _prune(bucket, now)
            if len(bucket) >= limits[key]:
                return False
        for key in keys:
            _hits[key].append(now)
    return True


def reset() -> None:
    """Test helper — clear in-memory buckets."""
    with _lock:
        _hits.clear()
