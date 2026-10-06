"""Shared language rules so user prompts work in any language."""

from __future__ import annotations

MULTILINGUAL_USER_PROMPT_RULE = (
    "LANGUAGE — The user prompt may be in any language or mixed languages "
    "(including Spanish, French, German, Portuguese, Italian, Chinese, Japanese, "
    "Korean, Arabic, Hindi, Russian, and others). Understand the request fully. "
    "Do not require English, refuse, or ask the user to switch languages. "
    "Preserve intent, numbers, units, @refs, and proper names. "
    "Write generation output (improved briefs, CAD/JSON/code identifiers, filenames) "
    "in clear English so kernels and catalogs stay consistent, while keeping distinctive "
    "product names in the user's original script when they are proper nouns."
)


def with_multilingual_prompt_rule(system: str) -> str:
    text = (system or "").rstrip()
    if "LANGUAGE — The user prompt may be in any language" in text:
        return text + "\n"
    return f"{text}\n\n{MULTILINGUAL_USER_PROMPT_RULE}\n"
