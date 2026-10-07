"""Worker-independent signed tickets for LAN robotics proxies."""

from __future__ import annotations

import time
from typing import Any

from jose import JWTError, jwt

from backend.auth import _jwt_secret


def issue_robotics_proxy_ticket(*, kind: str, user_id: str, host: str, port: int, ttl_sec: int) -> str:
    now = int(time.time())
    return jwt.encode(
        {
            "sub": str(user_id),
            "kind": str(kind),
            "host": str(host),
            "port": int(port),
            "iat": now,
            "exp": now + max(1, int(ttl_sec)),
        },
        _jwt_secret(),
        algorithm="HS256",
    )


def robotics_proxy_ticket_ok(token: str, *, kind: str, host: str, port: int) -> bool:
    if not token:
        return False
    try:
        payload: dict[str, Any] = jwt.decode(token, _jwt_secret(), algorithms=["HS256"])
    except JWTError:
        return False
    return payload.get("kind") == str(kind) and payload.get("host") == str(host) and int(payload.get("port") or 0) == int(port)
