"""Per-request context (client IP, etc.) for services outside FastAPI handlers."""

from __future__ import annotations

from contextvars import ContextVar, Token

_client_ip: ContextVar[str] = ContextVar("render3d_client_ip", default="")


def set_client_ip(ip: str) -> Token:
    return _client_ip.set(str(ip or "").strip())


def reset_client_ip(token: Token) -> None:
    _client_ip.reset(token)


def get_client_ip() -> str:
    return str(_client_ip.get() or "").strip()


def extract_client_ip(request: object) -> str:
    """Best-effort client IP from a Starlette/FastAPI Request (honors X-Forwarded-For)."""
    headers = getattr(request, "headers", None) or {}
    forwarded = ""
    try:
        forwarded = str(headers.get("x-forwarded-for") or headers.get("X-Forwarded-For") or "")
    except Exception:
        forwarded = ""
    if forwarded:
        # Left-most is the original client when proxies append.
        candidate = forwarded.split(",")[0].strip()
        return _normalize_ip(candidate)
    client = getattr(request, "client", None)
    host = getattr(client, "host", None) if client is not None else None
    return _normalize_ip(str(host or ""))


def _normalize_ip(value: str) -> str:
    raw = str(value or "").strip().strip("[]")
    if not raw or raw.lower() in {"unknown", "null", "undefined"}:
        return ""
    # Strip :port for IPv4 (avoid breaking IPv6).
    if raw.count(":") == 1 and "." in raw:
        raw = raw.split(":", 1)[0]
    if raw.lower().startswith("::ffff:"):
        raw = raw[7:]
    try:
        import ipaddress

        return str(ipaddress.ip_address(raw))
    except Exception:
        return raw[:80]
