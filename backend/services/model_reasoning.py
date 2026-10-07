"""Model-specific reasoning effort capabilities and request normalization."""

from __future__ import annotations

from typing import Any

STANDARD_EFFORTS = ("auto", "low", "medium", "high")
AUTO_ONLY = ("auto",)


def reasoning_efforts(provider: str | None, model: str | None) -> tuple[str, ...]:
    p = str(provider or "").strip().lower()
    m = str(model or "").strip().lower()
    if p == "openai" and m.startswith(("gpt-5.5", "gpt-5.6", "gpt-6")):
        return STANDARD_EFFORTS
    if p in {"gemini", "google"} and m.startswith(("gemini-2.5", "gemini-3.")):
        return STANDARD_EFFORTS
    if p in {"kimi", "moonshot"} and (m == "kimi-k3" or m.startswith("kimi-k3-")):
        return STANDARD_EFFORTS
    return AUTO_ONLY


def normalize_reasoning_effort(
    provider: str | None,
    model: str | None,
    effort: str | None,
) -> str | None:
    wanted = str(effort or "auto").strip().lower() or "auto"
    if wanted not in reasoning_efforts(provider, model) or wanted == "auto":
        return None
    return wanted


def configure_ai_reasoning(ai: Any, effort: str | None) -> Any:
    normalized = normalize_reasoning_effort(
        getattr(ai, "provider", None),
        getattr(ai, "model", None),
        effort,
    )
    setattr(ai, "reasoning_effort", normalized)
    return ai
