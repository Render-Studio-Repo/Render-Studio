"""Estimate USD cost from provider token usage (best-effort list prices)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

# USD per 1M tokens — OpenAI list prices (Responses / Chat Completions).
# Cached input is typically 10% of input unless the model has no cache discount (Pro).
# Astra / Sol long context: prompts >272K input bill the *full request* at 2× input/cache
# and 1.5× output (developers.openai.com/api/docs/pricing, Sep 2026).
_LONG_CTX_ASTRA = {
    "long_context_threshold": 272_000,
    "long_context_input": 20.0,
    "long_context_output": 75.0,
    "long_context_cached_input": 2.0,
    "long_context_cache_write": 25.0,
}
_LONG_CTX_SOL = {
    "long_context_threshold": 272_000,
    "long_context_input": 8.0,
    "long_context_output": 30.0,
    "long_context_cached_input": 0.80,
    "long_context_cache_write": 10.0,
}
_LONG_CTX_GPT61_SOL = {
    "long_context_threshold": 272_000,
    "long_context_input": 4.0,
    "long_context_output": 15.0,
    "long_context_cached_input": 0.20,
    "long_context_cache_write": 5.0,
}
# gpt-5.5 family still uses the older Sol-class long-ctx table.
_LONG_CTX_5X = {
    "long_context_threshold": 272_000,
    "long_context_input": 10.0,
    "long_context_output": 45.0,
    "long_context_cached_input": 1.0,
}
_LONG_CTX_TERRA = {
    "long_context_threshold": 272_000,
    "long_context_input": 4.0,
    "long_context_output": 18.0,
    "long_context_cached_input": 0.4,
}
_LONG_CTX_LUNA = {
    "long_context_threshold": 272_000,
    "long_context_input": 0.40,
    "long_context_output": 1.80,
    "long_context_cached_input": 0.04,
}
_ASTRA_RATES = {
    "input": 10.0,
    "output": 50.0,
    "cached_input": 1.0,
    "cache_write": 12.5,
    **_LONG_CTX_ASTRA,
}
_SOL_RATES = {
    "input": 4.0,
    "output": 20.0,
    "cached_input": 0.40,
    "cache_write": 5.0,
    **_LONG_CTX_SOL,
}
_GPT61_SOL_RATES = {
    "input": 2.0,
    "output": 10.0,
    "cached_input": 0.10,
    "cache_write": 2.5,
    **_LONG_CTX_GPT61_SOL,
}
_CODEX_RATES = {"input": 1.75, "output": 14.0, "cached_input": 0.175}

OPENAI_PRICING: dict[str, dict[str, float]] = {
    # Pro: no cached-input discount (OpenAI docs).
    "gpt-5.5-pro": {"input": 30.0, "output": 180.0, "cached_input": 30.0},
    "gpt-5.4-pro": {"input": 30.0, "output": 180.0, "cached_input": 30.0},
    "gpt-6.1-sol": dict(_GPT61_SOL_RATES),
    "gpt-5.6-sol": dict(_SOL_RATES),
    "gpt-5.6-terra": {
        "input": 2.0,
        "output": 12.0,
        "cached_input": 0.2,
        **_LONG_CTX_TERRA,
    },
    "gpt-5.6-luna": {
        "input": 0.20,
        "output": 1.20,
        "cached_input": 0.02,
        **_LONG_CTX_LUNA,
    },
    # Alias `gpt-5.6` routes to Sol.
    "gpt-5.6": dict(_SOL_RATES),
    "gpt-5.5": {
        "input": 5.0,
        "output": 30.0,
        "cached_input": 0.5,
        **_LONG_CTX_5X,
    },
    "gpt-5.4": {
        "input": 2.5,
        "output": 15.0,
        "cached_input": 0.25,
        **_LONG_CTX_TERRA,
    },
    # Astra Pro is a reasoning access mode, not a separate list price.
    "gpt-6-astra": dict(_ASTRA_RATES),
    "gpt-6-astra-pro": dict(_ASTRA_RATES),
    "gpt-5.3-codex": dict(_CODEX_RATES),
    "gpt-5.3": dict(_CODEX_RATES),
    "gpt-5.2-codex": dict(_CODEX_RATES),
    "gpt-5.2": dict(_CODEX_RATES),
    "gpt-5.1": {"input": 1.25, "output": 10.0, "cached_input": 0.125},
    "gpt-5": {"input": 1.25, "output": 10.0, "cached_input": 0.125},
    "gpt-4.1-mini": {"input": 0.4, "output": 1.6, "cached_input": 0.1},
    "gpt-4.1": {"input": 2.0, "output": 8.0, "cached_input": 0.5},
    "gpt-4o-mini": {"input": 0.15, "output": 0.60, "cached_input": 0.075},
    "gpt-4o": {"input": 2.5, "output": 10.0, "cached_input": 1.25},
    "o4-mini": {"input": 1.1, "output": 4.4, "cached_input": 0.275},
    "o3-pro": {"input": 20.0, "output": 80.0, "cached_input": 20.0},
    "o3-mini": {"input": 1.1, "output": 4.4, "cached_input": 0.55},
    "o3": {"input": 2.0, "output": 8.0, "cached_input": 0.5},
    "o1-pro": {"input": 150.0, "output": 600.0, "cached_input": 150.0},
    "o1-mini": {"input": 1.1, "output": 4.4, "cached_input": 0.55},
    "o1": {"input": 15.0, "output": 60.0, "cached_input": 7.5},
}

ANTHROPIC_PRICING: dict[str, dict[str, float]] = {
    # Fable 5.1: same $10/$50 as Fable 5; cache reads $0.25/MTok (Anthropic list, Sep 2026).
    "claude-fable-5-1": {"input": 10.0, "output": 50.0, "cached_input": 0.25, "cache_write": 12.5},
    "claude-mythos-5-1": {"input": 10.0, "output": 50.0, "cached_input": 0.25, "cache_write": 12.5},
    # Fable/Mythos 5: $10/$50 + cache write 1.25× / cache read 0.1× (Anthropic list).
    "claude-fable-5": {"input": 10.0, "output": 50.0, "cached_input": 1.0, "cache_write": 12.5},
    "claude-mythos-5": {"input": 10.0, "output": 50.0, "cached_input": 1.0, "cache_write": 12.5},
    # Opus 5 / 4.x: $5/$25 (Anthropic list, Jul 2026).
    "claude-opus-5": {"input": 5.0, "output": 25.0, "cached_input": 0.5, "cache_write": 6.25},
    "claude-opus-4-8": {"input": 5.0, "output": 25.0, "cached_input": 0.5, "cache_write": 6.25},
    "claude-opus-4-7": {"input": 5.0, "output": 25.0, "cached_input": 0.5, "cache_write": 6.25},
    "claude-4.6-opus": {"input": 5.0, "output": 25.0, "cached_input": 0.5, "cache_write": 6.25},
    "claude-opus-4-6": {"input": 5.0, "output": 25.0, "cached_input": 0.5, "cache_write": 6.25},
    "claude-opus-4-5": {"input": 5.0, "output": 25.0, "cached_input": 0.5, "cache_write": 6.25},
    "claude-4.6-sonnet": {"input": 3.0, "output": 15.0, "cached_input": 0.3, "cache_write": 3.75},
    "claude-sonnet-4-6": {"input": 3.0, "output": 15.0, "cached_input": 0.3, "cache_write": 3.75},
    "claude-sonnet-4-5": {"input": 3.0, "output": 15.0, "cached_input": 0.3, "cache_write": 3.75},
    "claude-haiku-4-5": {"input": 1.0, "output": 5.0, "cached_input": 0.1, "cache_write": 1.25},
    "claude-opus-4": {"input": 15.0, "output": 75.0, "cached_input": 1.5, "cache_write": 18.75},
    "claude-haiku": {"input": 0.25, "output": 1.25, "cached_input": 0.03, "cache_write": 0.3125},
}

# Moonshot / Kimi list prices (USD per 1M tokens, international api.moonshot.ai).
KIMI_PRICING: dict[str, dict[str, float]] = {
    "kimi-k3": {"input": 3.0, "output": 15.0, "cached_input": 0.30},
    "kimi-k2.6": {"input": 0.95, "output": 4.0, "cached_input": 0.16},
    "kimi-k2.7-code": {"input": 0.95, "output": 4.0, "cached_input": 0.19},
    "kimi-k2.5": {"input": 0.60, "output": 3.0, "cached_input": 0.10},
}

# xAI / Grok list prices. Requests ≥200k prompt tokens bill the whole request at the higher tier.
_LONG_CTX_GROK = {
    "long_context_threshold": 200_000,
    "long_context_input": 4.0,
    "long_context_output": 12.0,
    "long_context_cached_input": 0.60,
}
XAI_PRICING: dict[str, dict[str, float]] = {
    "grok-4.5": {
        "input": 2.0,
        "output": 6.0,
        "cached_input": 0.30,
        **_LONG_CTX_GROK,
    },
    "grok-4.5-latest": {
        "input": 2.0,
        "output": 6.0,
        "cached_input": 0.30,
        **_LONG_CTX_GROK,
    },
}

# Gemini API list prices (USD per 1M tokens). 3.8 Flash intro pricing through 2026-12-31.
GEMINI_PRICING: dict[str, dict[str, float]] = {
    "gemini-3.8-flash": {"input": 0.75, "output": 3.75, "cached_input": 0.075},
    "gemini-3.7-flash": {"input": 0.75, "output": 3.75, "cached_input": 0.075},
    "gemini-3.6-flash": {"input": 0.75, "output": 3.75, "cached_input": 0.075},
    "gemini-2.5-pro": {"input": 1.25, "output": 10.0, "cached_input": 0.125},
    "gemini-2.5-flash": {"input": 0.30, "output": 2.50, "cached_input": 0.030},
}

# DashScope / Qwen list prices (USD per 1M tokens, international ballpark).
QWEN_PRICING: dict[str, dict[str, float]] = {
    "qwen3-coder-plus": {"input": 1.00, "output": 5.00, "cached_input": 0.10},
    "qwen3-coder-flash": {"input": 0.30, "output": 1.50, "cached_input": 0.03},
    "qwen-max": {"input": 1.60, "output": 6.40, "cached_input": 0.16},
    "qwen-plus": {"input": 0.40, "output": 1.20, "cached_input": 0.04},
    "qwen-turbo": {"input": 0.05, "output": 0.20, "cached_input": 0.005},
}


def _pricing_table(provider: str) -> dict[str, dict[str, float]]:
    if provider == "anthropic":
        return ANTHROPIC_PRICING
    if provider in {"kimi", "moonshot"}:
        return KIMI_PRICING
    if provider in {"xai", "grok"}:
        return XAI_PRICING
    if provider in {"gemini", "google"}:
        return GEMINI_PRICING
    if provider in {"qwen", "dashscope", "alibaba"}:
        return QWEN_PRICING
    return OPENAI_PRICING


def _pricing_for_model(model: str | None, provider: str = "openai") -> dict[str, float]:
    name = (model or "").strip().lower()
    table = _pricing_table(provider)
    # Longest key first. Only exact / dated-snapshot / key- suffix matches —
    # bare startswith("gpt-5") must NOT steal future ids like gpt-5.7-pro.
    for key in sorted(table.keys(), key=len, reverse=True):
        if name == key or name.startswith(key + "-"):
            return table[key]
    for key in sorted(table.keys(), key=len, reverse=True):
        # Whole-token containment (e.g. "haiku" inside "claude-haiku-4-5").
        if f"-{key}-" in f"-{name}-" or name.endswith(f"-{key}") or name.startswith(f"{key}-"):
            return table[key]
    if name in {"chatgpt", "codex", "chatgpt-default", "default"}:
        return table.get("gpt-5.3-codex") or dict(_CODEX_RATES)
    # Heuristics for unknown / future model ids (no per-model allowlist required).
    if provider == "anthropic":
        if any(tok in name for tok in ("fable", "mythos")):
            return {"input": 10.0, "output": 50.0, "cached_input": 1.0, "cache_write": 12.5}
        if "opus" in name:
            return {"input": 5.0, "output": 25.0, "cached_input": 0.5, "cache_write": 6.25}
        if "haiku" in name:
            return {"input": 1.0, "output": 5.0, "cached_input": 0.1, "cache_write": 1.25}
        # Default unknown Anthropic → Sonnet-class
        return {"input": 3.0, "output": 15.0, "cached_input": 0.3, "cache_write": 3.75}
    if provider in {"kimi", "moonshot"}:
        if "k3" in name:
            return {"input": 3.0, "output": 15.0, "cached_input": 0.30}
        if "2.5" in name:
            return {"input": 0.60, "output": 3.0, "cached_input": 0.10}
        return {"input": 0.95, "output": 4.0, "cached_input": 0.16}
    if provider in {"xai", "grok"}:
        return {
            "input": 2.0,
            "output": 6.0,
            "cached_input": 0.30,
            **_LONG_CTX_GROK,
        }
    if provider in {"gemini", "google"}:
        if "pro" in name:
            return {"input": 1.25, "output": 10.0, "cached_input": 0.125}
        return {"input": 0.75, "output": 3.75, "cached_input": 0.075}
    if provider in {"qwen", "dashscope", "alibaba"}:
        if "turbo" in name or "flash" in name:
            return {"input": 0.30, "output": 1.50, "cached_input": 0.03}
        if "max" in name:
            return {"input": 1.60, "output": 6.40, "cached_input": 0.16}
        if "coder" in name:
            return {"input": 1.00, "output": 5.00, "cached_input": 0.10}
        return {"input": 0.40, "output": 1.20, "cached_input": 0.04}
    if "astra" in name:
        return dict(_ASTRA_RATES)
    if "pro" in name:
        return {"input": 30.0, "output": 180.0, "cached_input": 30.0}
    if "sol" in name:
        return dict(_SOL_RATES)
    if "terra" in name:
        return {
            "input": 2.0,
            "output": 12.0,
            "cached_input": 0.2,
            **_LONG_CTX_TERRA,
        }
    if "luna" in name:
        return {
            "input": 0.20,
            "output": 1.20,
            "cached_input": 0.02,
            **_LONG_CTX_LUNA,
        }
    if "codex" in name:
        return dict(_CODEX_RATES)
    if name.startswith("o1-pro") or name.startswith("o3-pro"):
        return {"input": 20.0, "output": 80.0, "cached_input": 20.0}
    if name.startswith(("o1", "o3", "o4")):
        return {"input": 2.0, "output": 8.0, "cached_input": 0.5}
    if name.startswith("gpt-5") or name.startswith("gpt-4.1"):
        return {
            "input": 5.0,
            "output": 30.0,
            "cached_input": 0.5,
            **_LONG_CTX_5X,
        }
    # Conservative OpenAI default for brand-new ids
    return {"input": 5.0, "output": 30.0, "cached_input": 0.5}


def _usage_attr(obj: Any, *names: str, default: Any = 0) -> Any:
    if obj is None:
        return default
    if isinstance(obj, dict):
        for name in names:
            if obj.get(name) is not None:
                return obj.get(name)
        return default
    for name in names:
        val = getattr(obj, name, None)
        if val is not None:
            return val
    return default


def _coerce_usage_object(usage: Any) -> Any:
    if usage is None:
        return None
    if isinstance(usage, dict):
        return usage
    # Pydantic / SDK models
    for meth in ("model_dump", "to_dict", "dict"):
        fn = getattr(usage, meth, None)
        if callable(fn):
            try:
                dumped = fn()
                if isinstance(dumped, dict):
                    return dumped
            except Exception:
                pass
    return usage


def normalize_openai_usage(usage: Any) -> dict[str, int]:
    """Normalize Chat Completions or Responses API usage into a flat token dict."""
    usage = _coerce_usage_object(usage)
    if not usage:
        return {}
    input_tokens = int(
        _usage_attr(usage, "input_tokens", "prompt_tokens", default=0) or 0
    )
    output_tokens = int(
        _usage_attr(usage, "output_tokens", "completion_tokens", default=0) or 0
    )
    total_tokens = int(_usage_attr(usage, "total_tokens", default=0) or 0)
    if total_tokens <= 0:
        total_tokens = input_tokens + output_tokens
    details = _usage_attr(
        usage, "input_tokens_details", "prompt_tokens_details", default=None
    )
    cached_input = int(_usage_attr(details, "cached_tokens", default=0) or 0)
    # Some Responses payloads expose cache fields at the top level.
    if not cached_input:
        cached_input = int(
            _usage_attr(
                usage,
                "cached_input_tokens",
                "cache_read_input_tokens",
                default=0,
            )
            or 0
        )
    out_details = _usage_attr(
        usage, "output_tokens_details", "completion_tokens_details", default=None
    )
    reasoning_tokens = int(_usage_attr(out_details, "reasoning_tokens", default=0) or 0)
    if not reasoning_tokens:
        reasoning_tokens = int(_usage_attr(usage, "reasoning_tokens", default=0) or 0)
    payload: dict[str, int] = {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": total_tokens,
    }
    if cached_input:
        payload["cached_input_tokens"] = cached_input
    if reasoning_tokens:
        # Subset of output_tokens for display; billed via output rate already.
        payload["reasoning_tokens"] = reasoning_tokens
    return payload


def usage_from_openai_response(response: Any) -> dict[str, int]:
    """Extract usage from an OpenAI SDK response, dict payload, or raw usage object."""
    if response is None:
        return {}
    if isinstance(response, dict):
        if "input_tokens" in response or "prompt_tokens" in response or "output_tokens" in response:
            return normalize_openai_usage(response)
        usage = response.get("usage")
        return normalize_openai_usage(usage)
    usage = getattr(response, "usage", None)
    if usage is None and hasattr(response, "get"):
        try:
            usage = response.get("usage")  # type: ignore[call-arg]
        except Exception:
            usage = None
    return normalize_openai_usage(usage)


def usage_from_anthropic_response(data: dict[str, Any]) -> dict[str, int]:
    usage = data.get("usage") or {}
    input_tokens = int(usage.get("input_tokens") or 0)
    output_tokens = int(usage.get("output_tokens") or 0)
    cache_creation = int(usage.get("cache_creation_input_tokens") or 0)
    cache_read = int(usage.get("cache_read_input_tokens") or 0)
    # Nested cache_creation buckets (5m / 1h) if top-level is absent.
    if not cache_creation and isinstance(usage.get("cache_creation"), dict):
        created = usage["cache_creation"]
        cache_creation = int(created.get("ephemeral_5m_input_tokens") or 0) + int(
            created.get("ephemeral_1h_input_tokens") or 0
        )
    thinking_tokens = 0
    details = usage.get("output_tokens_details")
    if isinstance(details, dict):
        thinking_tokens = int(details.get("thinking_tokens") or 0)
    payload: dict[str, int] = {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": input_tokens + output_tokens + cache_creation + cache_read,
    }
    if cache_creation:
        payload["cache_creation_input_tokens"] = cache_creation
    if cache_read:
        payload["cached_input_tokens"] = cache_read
        payload["cache_read_input_tokens"] = cache_read
    if thinking_tokens:
        payload["thinking_tokens"] = thinking_tokens
    return payload


def should_apply_long_context(model: str | None, meta: dict[str, Any] | None = None) -> bool:
    """Long-context (272K) is per API request, not Codex session-cumulative usage."""
    meta = meta or {}
    source = str(
        meta.get("billing_source") or meta.get("key_source") or meta.get("ai_key_source") or ""
    ).strip().lower()
    if source in {"chatgpt", "chatgpt_subscription", "codex"}:
        return False
    name = (model or "").strip().lower()
    # Astra / Astra Pro in this studio always run via Codex CLI (`codex exec`).
    if "astra" in name or name in {"chatgpt", "codex", "chatgpt-default", "default"}:
        return False
    return True


def estimate_cost_usd(
    model: str | None,
    usage: dict[str, int] | None,
    *,
    provider: str = "openai",
    apply_long_context: bool | None = None,
) -> float | None:
    if not usage:
        return None
    input_tokens = int(usage.get("input_tokens") or 0)
    output_tokens = int(usage.get("output_tokens") or 0)
    cached_input = int(usage.get("cached_input_tokens") or usage.get("cache_read_input_tokens") or 0)
    cache_creation = int(usage.get("cache_creation_input_tokens") or 0)
    if input_tokens == 0 and output_tokens == 0 and cached_input == 0 and cache_creation == 0:
        return None
    prices = dict(_pricing_for_model(model, provider))
    if apply_long_context is None:
        apply_long_context = should_apply_long_context(model)
    # Codex CLI usage is session-cumulative across many turns. The 272K long-context
    # multiplier is per API request — do not apply it to a summed session blob.
    if apply_long_context and input_tokens >= int(prices.get("long_context_threshold") or 10**18):
        prices["input"] = float(prices.get("long_context_input", prices["input"]))
        prices["output"] = float(prices.get("long_context_output", prices["output"]))
        prices["cached_input"] = float(
            prices.get("long_context_cached_input", prices.get("cached_input", prices["input"]))
        )
        if "long_context_cache_write" in prices:
            prices["cache_write"] = float(prices["long_context_cache_write"])
        elif "cache_write" not in prices:
            prices["cache_write"] = prices["input"] * 1.25
    # Anthropic reports uncached input separately from cache read/write.
    billable_input = max(0, input_tokens - (cached_input if provider != "anthropic" else 0))
    cache_write_rate = float(prices.get("cache_write", prices["input"] * 1.25))
    cache_read_rate = float(prices.get("cached_input", prices["input"] * 0.1))
    cost = (
        billable_input * prices["input"] / 1_000_000
        + cache_creation * cache_write_rate / 1_000_000
        + cached_input * cache_read_rate / 1_000_000
        + output_tokens * prices["output"] / 1_000_000
    )
    return round(cost, 6)


def summarize_ai_traces(traces: list[dict[str, Any]] | dict[str, Any] | None) -> dict[str, Any]:
    """Aggregate token usage and estimated cost from one or more AI call traces."""
    empty: dict[str, Any] = {
        "usage": {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0},
        "cost_usd": 0.0,
        "calls": 0,
        "models": [],
        "provider": None,
    }
    if not traces:
        return empty
    items = traces if isinstance(traces, list) else [traces]
    totals: dict[str, int] = {
        "input_tokens": 0,
        "output_tokens": 0,
        "total_tokens": 0,
        "cached_input_tokens": 0,
        "reasoning_tokens": 0,
        "cache_creation_input_tokens": 0,
    }
    cost_usd = 0.0
    calls = 0
    models: list[str] = []
    provider = None
    for trace in items:
        if not isinstance(trace, dict):
            continue
        if trace.get("provider") == "deterministic":
            continue
        usage = trace.get("usage") or {}
        if not usage:
            continue
        calls += 1
        provider = trace.get("provider") or provider or "openai"
        model = trace.get("model")
        if model and model not in models:
            models.append(model)
        totals["input_tokens"] += int(usage.get("input_tokens") or 0)
        totals["output_tokens"] += int(usage.get("output_tokens") or 0)
        totals["total_tokens"] += int(usage.get("total_tokens") or 0)
        totals["cached_input_tokens"] += int(
            usage.get("cached_input_tokens") or usage.get("cache_read_input_tokens") or 0
        )
        totals["reasoning_tokens"] += int(usage.get("reasoning_tokens") or usage.get("thinking_tokens") or 0)
        totals["cache_creation_input_tokens"] += int(usage.get("cache_creation_input_tokens") or 0)
        call_cost = trace.get("cost_usd")
        if call_cost is None:
            call_cost = estimate_cost_usd(
                model,
                usage,
                provider=provider or "openai",
                apply_long_context=should_apply_long_context(model, trace),
            )
        if call_cost is not None:
            cost_usd += float(call_cost)
    if calls == 0:
        return empty
    # Drop zero-only detail fields so history stays compact.
    usage_out = {
        "input_tokens": totals["input_tokens"],
        "output_tokens": totals["output_tokens"],
        "total_tokens": totals["total_tokens"],
    }
    for key in ("cached_input_tokens", "reasoning_tokens", "cache_creation_input_tokens"):
        if totals[key]:
            usage_out[key] = totals[key]
    return {
        "usage": usage_out,
        "cost_usd": round(cost_usd, 6),
        "calls": calls,
        "models": models,
        "provider": provider,
    }


def usage_fields_for_history(ai_traces: list[dict[str, Any]] | dict[str, Any] | None) -> dict[str, Any]:
    summary = summarize_ai_traces(ai_traces)
    if summary["calls"] > 0:
        fields: dict[str, Any] = {
            "usage": summary["usage"],
            "cost_usd": summary["cost_usd"],
            "ai_calls": summary["calls"],
        }
        if summary.get("models"):
            fields["model"] = summary["models"][0] if len(summary["models"]) == 1 else ", ".join(summary["models"])
        if summary.get("provider"):
            fields["provider"] = summary["provider"]
        return fields
    # Deterministic pipelines (mount compiler, bottle generator, etc.) — tracked at $0.
    if ai_traces:
        items = ai_traces if isinstance(ai_traces, list) else [ai_traces]
        det = next((t for t in items if isinstance(t, dict) and t.get("provider") == "deterministic"), None)
        if det:
            generator = det.get("generator") or "deterministic"
            return {
                "usage": {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0},
                "cost_usd": 0.0,
                "ai_calls": 0,
                "model": generator,
                "provider": "deterministic",
            }
    return {}


CHAT_PLAN_KEY_SOURCES = frozenset({
    "chatgpt",
    "chatgpt_subscription",
    "subscription",
})


def infer_provider(entry: dict[str, Any] | None, model: str | None = None) -> str:
    """Provider used for pricing and the account-menu split.

    History rows often defaulted missing provider to ``openai``, which dumped Claude
    (and Kimi/Gemini) spend into the OpenAI bucket. Model id wins when it is unambiguous.
    """
    row = entry or {}
    name = str(model or row.get("model") or "").strip().lower()
    stored = str(row.get("provider") or "").strip().lower()
    if stored in {"kimi", "moonshot"}:
        stored = "kimi"
    elif stored in {"xai", "grok"}:
        stored = "xai"
    elif stored in {"gemini", "google"}:
        stored = "gemini"
    elif stored in {"qwen", "dashscope", "alibaba"}:
        stored = "qwen"

    guessed = ""
    if any(tok in name for tok in ("claude", "anthropic", "fable", "mythos", "sonnet", "haiku", "opus")):
        guessed = "anthropic"
    elif "kimi" in name or "moonshot" in name:
        guessed = "kimi"
    elif "gemini" in name:
        guessed = "gemini"
    elif "qwen" in name:
        guessed = "qwen"
    elif "grok" in name:
        guessed = "xai"
    elif name or stored:
        guessed = "openai"

    if guessed and guessed != "openai" and (not stored or stored == "openai"):
        return guessed
    return stored or guessed or "openai"


def is_chatgpt_plan_entry(entry: dict[str, Any] | None) -> bool:
    """True when the prompt billed a ChatGPT/Codex login, not an API key."""
    row = entry or {}
    source = str(
        row.get("key_source") or row.get("billing_source") or row.get("ai_key_source") or ""
    ).strip().lower()
    if source in CHAT_PLAN_KEY_SOURCES:
        return True
    # ``codex`` as key_source is ChatGPT device-auth in this app. Codex-on-API-key
    # stores personal/team/platform instead.
    if source == "codex":
        return True
    return False


def entries_attributed_to_user(entries: list[dict[str, Any]], user_id: str) -> list[dict[str, Any]]:
    """Keep this user's prompts; include unattributed rows only on solo projects."""
    uid = str(user_id or "").strip()
    if not uid:
        return list(entries)
    other_ids = {
        str(e.get("user_id")).strip()
        for e in entries
        if str(e.get("user_id") or "").strip() and str(e.get("user_id")).strip() != uid
    }
    kept: list[dict[str, Any]] = []
    for entry in entries:
        raw = str(entry.get("user_id") or "").strip()
        if not raw:
            if not other_ids:
                kept.append(entry)
            continue
        if raw == uid:
            kept.append(entry)
    return kept


def parse_month_param(month: str | None) -> tuple[int, int]:
    """Parse YYYY-MM or return current UTC month."""
    now = datetime.now(timezone.utc)
    if not month:
        return now.year, now.month
    raw = month.strip()
    if len(raw) == 7 and raw[4] == "-":
        year = int(raw[:4])
        mon = int(raw[5:7])
        if 1 <= mon <= 12:
            return year, mon
    raise ValueError("month must be YYYY-MM")


def month_label(year: int, month: int) -> str:
    return datetime(year, month, 1, tzinfo=timezone.utc).strftime("%B %Y")


def entry_in_month(entry: dict[str, Any], year: int, month: int) -> bool:
    created = entry.get("created_at")
    if not created:
        return False
    try:
        dt = datetime.fromisoformat(str(created).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        dt = dt.astimezone(timezone.utc)
    except (TypeError, ValueError):
        return False
    return dt.year == year and dt.month == month


def filter_entries_for_month(entries: list[dict[str, Any]], year: int, month: int) -> list[dict[str, Any]]:
    return [e for e in entries if entry_in_month(e, year, month)]


def entry_effective_cost(entry: dict[str, Any]) -> float | None:
    """Best-effort USD cost for one prompt history row."""
    usage = entry.get("usage")
    model = entry.get("model")
    provider = infer_provider(entry, model)
    status = str(entry.get("status") or "").strip().lower()
    if status == "running":
        return None
    if usage and str(model or "").lower().startswith("claude-fable-5"):
        # Early Fable 5 rows were recorded with placeholder Haiku-like pricing.
        return estimate_cost_usd(model, usage, provider=provider)
    if entry.get("cost_usd") is not None:
        try:
            stored = float(entry["cost_usd"])
        except (TypeError, ValueError):
            stored = None
        else:
            # Re-price when the row was tagged OpenAI but the model is clearly Claude/Kimi.
            stored_prov = str(entry.get("provider") or "").strip().lower()
            if usage and provider != "openai" and stored_prov in {"", "openai"}:
                recomputed = estimate_cost_usd(
                    model,
                    usage,
                    provider=provider,
                    apply_long_context=should_apply_long_context(model, entry),
                )
                if recomputed is not None:
                    return recomputed
            return stored
    if not usage:
        return None
    return estimate_cost_usd(
        model,
        usage,
        provider=provider,
        apply_long_context=should_apply_long_context(model, entry),
    )


def _entry_completeness(entry: dict[str, Any]) -> int:
    score = 0
    if entry.get("cost_usd") is not None:
        score += 1000
    if entry.get("usage"):
        score += 500
    if entry.get("trace_id"):
        score += 100
    if not entry.get("recovered_from_timeline") and not entry.get("recovered"):
        score += 50
    return score


def dedupe_prompt_entries(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Drop duplicate timeline/recovery rows so spend is not under- or over-counted."""
    if not entries:
        return []

    best_by_trace: dict[str, dict[str, Any]] = {}
    for entry in entries:
        trace_id = entry.get("trace_id")
        if not trace_id:
            continue
        prev = best_by_trace.get(str(trace_id))
        if not prev or _entry_completeness(entry) > _entry_completeness(prev):
            best_by_trace[str(trace_id)] = entry

    billed_prompts = {
        (e.get("prompt") or "")[:320]
        for e in entries
        if entry_effective_cost(e) is not None
    }

    kept: list[dict[str, Any]] = []
    seen_traces: set[str] = set()
    seen_prompts: set[str] = set()

    for entry in sorted(entries, key=_entry_completeness, reverse=True):
        trace_id = entry.get("trace_id")
        if trace_id:
            tid = str(trace_id)
            if tid in seen_traces:
                continue
            seen_traces.add(tid)
            kept.append(best_by_trace.get(tid, entry))
            continue

        prompt_key = (entry.get("prompt") or "")[:320]
        if (entry.get("recovered_from_timeline") or entry.get("recovered")) and prompt_key in billed_prompts:
            continue
        if prompt_key and prompt_key in seen_prompts:
            continue
        if prompt_key:
            seen_prompts.add(prompt_key)
        kept.append(entry)

    kept.sort(key=lambda e: e.get("created_at") or "")
    return kept


def summarize_entries(entries: list[dict[str, Any]]) -> dict[str, Any]:
    """Token/cost totals for prompt history entries."""
    entries = dedupe_prompt_entries(entries)
    totals = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
    cost_usd = 0.0
    openai_cost_usd = 0.0
    anthropic_cost_usd = 0.0
    kimi_cost_usd = 0.0
    chatgpt_cost_usd = 0.0
    other_cost_usd = 0.0
    tracked = 0
    providers_seen: list[str] = []
    models_seen: list[str] = []
    model_breakdown: dict[str, dict[str, Any]] = {}
    for entry in entries:
        usage = entry.get("usage") or {}
        entry_cost = entry_effective_cost(entry)
        if str(entry.get("status") or "").strip().lower() == "running":
            continue
        if entry_cost is None and not usage:
            continue
        tracked += 1
        for key in totals:
            totals[key] += int(usage.get(key) or 0)
        entry_cost = float(entry_cost or 0)
        cost_usd += entry_cost
        prov = infer_provider(entry)
        if is_chatgpt_plan_entry(entry):
            chatgpt_cost_usd += entry_cost
        elif prov == "openai":
            openai_cost_usd += entry_cost
        elif prov == "anthropic":
            anthropic_cost_usd += entry_cost
        elif prov == "kimi":
            kimi_cost_usd += entry_cost
        else:
            other_cost_usd += entry_cost
        if prov not in providers_seen:
            providers_seen.append(prov)
        model = entry.get("model") or ""
        if model and model not in models_seen:
            models_seen.append(model)
        model_key = f"{prov}:{model or 'unknown'}"
        model_item = model_breakdown.setdefault(
            model_key,
            {
                "provider": prov,
                "model": model or None,
                "prompt_count": 0,
                "tracked_count": 0,
                "input_tokens": 0,
                "output_tokens": 0,
                "total_tokens": 0,
                "cost_usd": 0.0,
                "ai_calls": 0,
            },
        )
        model_item["prompt_count"] += 1
        model_item["tracked_count"] += 1
        model_item["input_tokens"] += int(usage.get("input_tokens") or 0)
        model_item["output_tokens"] += int(usage.get("output_tokens") or 0)
        model_item["total_tokens"] += int(usage.get("total_tokens") or 0)
        model_item["cost_usd"] += entry_cost
        model_item["ai_calls"] += int(entry.get("ai_calls") or 0)
    # Dominant provider: whichever has the most spend
    dominant_provider: str | None = None
    if providers_seen:
        spend_by_provider = {
            "openai": openai_cost_usd + chatgpt_cost_usd,
            "anthropic": anthropic_cost_usd,
            "kimi": kimi_cost_usd,
        }
        dominant_provider = max(
            providers_seen,
            key=lambda p: spend_by_provider.get(p, other_cost_usd),
        )
    dominant_model = models_seen[0] if len(models_seen) == 1 else (", ".join(models_seen) if models_seen else None)
    return {
        "prompt_count": len(entries),
        "tracked_count": tracked,
        "untracked_count": max(0, len(entries) - tracked),
        "usage": totals,
        "cost_usd": round(cost_usd, 4),
        "openai_cost_usd": round(openai_cost_usd, 4),
        "anthropic_cost_usd": round(anthropic_cost_usd, 4),
        "kimi_cost_usd": round(kimi_cost_usd, 4),
        "chatgpt_cost_usd": round(chatgpt_cost_usd, 4),
        "other_cost_usd": round(other_cost_usd, 4),
        "cost_basis": "estimated_list_price",
        "provider": dominant_provider,
        "model": dominant_model,
        "model_breakdown": sorted(
            [
                {
                    **item,
                    "cost_usd": round(float(item["cost_usd"]), 6),
                }
                for item in model_breakdown.values()
            ],
            key=lambda item: float(item.get("cost_usd") or 0),
            reverse=True,
        ),
    }
