"""Collapse duplicated voice / XR spoken-prompt blocks before CAD generate."""

from __future__ import annotations

import re

_SPOKEN_SPLIT = re.compile(
    r"(?:^|\n)\s*Spoken\s*/\s*transcribed\s+prompt:\s*",
    re.IGNORECASE,
)
_SPOKEN_HEADER = re.compile(
    r"^\s*Spoken\s*/\s*transcribed\s+prompt:\s*",
    re.IGNORECASE,
)
_WS = re.compile(r"\s+")


def collapse_repeated_spoken_prompt(text: str | None) -> str:
    raw = str(text or "").replace("\r", "").strip()
    if not raw:
        return ""
    if _SPOKEN_SPLIT.search("\n" + raw):
        parts = _SPOKEN_SPLIT.split(raw)
    else:
        parts = re.split(r"\n{2,}", raw)
    chunks: list[str] = []
    seen: set[str] = set()
    for part in parts:
        chunk = _WS.sub(" ", _SPOKEN_HEADER.sub("", part or "")).strip()
        if not chunk:
            continue
        key = chunk.lower()
        if key in seen:
            continue
        seen.add(key)
        chunks.append(chunk)
    return "\n".join(chunks)
