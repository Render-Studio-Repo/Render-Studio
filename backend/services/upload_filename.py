"""Validate one uploaded basename before constructing a project filesystem path."""
from __future__ import annotations

import re
import unicodedata

MAX_FILENAME_BYTES = 255
_BIDI_CONTROLS = frozenset("\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069")


def validate_upload_filename(value: str | None) -> str:
    """Return the exact safe basename, preserving ordinary Unicode and spaces.

    Reject paths rather than silently changing their target. ZIP/folder entries
    have a separate path-aware importer; this applies to a single multipart file.
    """
    if not isinstance(value, str) or not value.strip() or value.strip() in {".", ".."}:
        raise ValueError("Choose a file with a valid filename.")
    if "/" in value or "\\" in value or re.match(r"^[A-Za-z]:", value):
        raise ValueError("Upload a single filename without folders or drive paths.")
    if any(unicodedata.category(char) in {"Cc", "Cs"} or char in _BIDI_CONTROLS for char in value):
        raise ValueError("Filenames cannot contain control characters.")
    if len(value.encode("utf-8")) > MAX_FILENAME_BYTES:
        raise ValueError("Filename is too long. Use at most 255 UTF-8 bytes.")
    return value
