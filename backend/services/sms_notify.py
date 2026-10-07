"""Best-effort SMS notify via Twilio REST (no SDK required).

Studio alerts text Sam at DEVELOPER_PHONE. Credentials come from process env,
Render Studio ``.env``, or the AHM project ``.env`` (same Twilio account / from
number that already texts him).
"""

from __future__ import annotations

import base64
import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

DEVELOPER_PHONE = "+15013171132"

_AHM_ENV_CANDIDATES = (
    Path("/Users/sam/AHM_Arkansas_Mac/.env"),
    Path("/Users/sam/Documents/AHM_Arkansas_Mac/.env"),
    Path.home() / "AHM_Arkansas_Mac" / ".env",
    Path.home() / "Documents" / "AHM_Arkansas_Mac" / ".env",
)


def _parse_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    try:
        if not path.is_file():
            return out
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip("'").strip('"')
            if key and value:
                out[key] = value
    except OSError:
        return {}
    return out


def _studio_env_path() -> Path:
    try:
        from backend.config import ENV_FILE

        return Path(ENV_FILE)
    except Exception:
        return Path(__file__).resolve().parents[2] / ".env"


def _merged_env() -> dict[str, str]:
    merged: dict[str, str] = {}
    for path in (*_AHM_ENV_CANDIDATES, _studio_env_path()):
        parsed = _parse_env_file(path)
        if parsed:
            merged.update(parsed)
    merged.update({key: str(val) for key, val in os.environ.items() if val})
    return merged


def _twilio_creds() -> tuple[str, str, str] | None:
    env = _merged_env()
    sid = (env.get("TWILIO_ACCOUNT_SID") or "").strip()
    token = (env.get("TWILIO_AUTH_TOKEN") or "").strip()
    from_num = (
        env.get("TWILIO_FROM_NUMBER")
        or env.get("TWILIO_PHONE_NUMBER")
        or env.get("AHM_BUY_TWILIO_FROM_NUMBER")
        or ""
    ).strip()
    if sid and token and from_num:
        return sid, token, from_num
    return None


def normalize_phone(raw: str) -> str:
    digits = "".join(ch for ch in str(raw or "") if ch.isdigit())
    if len(digits) == 10:
        return f"+1{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    if str(raw or "").startswith("+") and digits:
        return f"+{digits}"
    return DEVELOPER_PHONE


def send_sms(body: str, *, to: str = DEVELOPER_PHONE) -> dict[str, Any]:
    """Send an SMS. Returns {ok, sid?} or {ok: False, error, queued}."""
    text = (body or "").strip()
    if not text:
        return {"ok": False, "error": "Empty SMS body"}
    # Twilio SMS soft limit ~1600 chars for concatenated messages; keep short.
    text = text[:1400]
    to_phone = normalize_phone(to)
    creds = _twilio_creds()
    if not creds:
        logger.warning("Twilio not configured; SMS not sent to %s: %s", to_phone, text[:200])
        return {
            "ok": False,
            "error": "Twilio not configured (set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER)",
            "queued": True,
            "to": to_phone,
            "preview": text[:240],
        }
    sid, token, from_num = creds
    url = f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"
    data = urllib.parse.urlencode({"To": to_phone, "From": from_num, "Body": text}).encode("utf-8")
    auth = base64.b64encode(f"{sid}:{token}".encode("ascii")).decode("ascii")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Authorization": f"Basic {auth}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            payload = json.loads(resp.read().decode("utf-8") or "{}")
        return {"ok": True, "sid": payload.get("sid"), "to": to_phone, "status": payload.get("status")}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:400]
        logger.warning("Twilio SMS failed: %s %s", exc.code, detail)
        return {"ok": False, "error": f"Twilio HTTP {exc.code}: {detail}", "to": to_phone, "queued": True}
    except Exception as exc:
        logger.warning("Twilio SMS error: %s", exc)
        return {"ok": False, "error": str(exc), "to": to_phone, "queued": True}
