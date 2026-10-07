"""Redact Authorization and secret-shaped tokens from log records."""

from __future__ import annotations

import logging
import re

_AUTH = re.compile(r"(?i)(authorization\s*[:=]\s*bearer\s+)(\S+)")
_JWT = re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b")
_SBP = re.compile(r"\bsbp_[A-Za-z0-9]{20,}\b")
_SERVICE = re.compile(r"\bsb_secret_[A-Za-z0-9_-]+\b")
_PUB = re.compile(r"\bsb_publishable_[A-Za-z0-9_-]+\b")


def redact_text(text: str) -> str:
    raw = str(text or "")
    raw = _AUTH.sub(r"\1[redacted]", raw)
    raw = _JWT.sub("[redacted-jwt]", raw)
    raw = _SBP.sub("[redacted-pat]", raw)
    raw = _SERVICE.sub("[redacted-secret]", raw)
    raw = _PUB.sub("[redacted-publishable]", raw)
    return raw


class RedactSecretsFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            record.msg = redact_text(str(record.msg))
            if record.args:
                if isinstance(record.args, dict):
                    record.args = {k: redact_text(str(v)) if isinstance(v, str) else v for k, v in record.args.items()}
                elif isinstance(record.args, tuple):
                    record.args = tuple(redact_text(a) if isinstance(a, str) else a for a in record.args)
        except Exception:
            pass
        return True


def install() -> None:
    filt = RedactSecretsFilter()
    logging.getLogger().addFilter(filt)
    for name in ("uvicorn", "uvicorn.access", "uvicorn.error", "render3d", "render3d.supabase", "render3d.supabase_users"):
        logging.getLogger(name).addFilter(filt)
