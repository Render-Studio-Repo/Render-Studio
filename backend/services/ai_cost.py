"""Estimate USD cost from provider token usage (best-effort list prices)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

# USD per 1M tokens — OpenAI list prices (Responses / Chat Completions).
# Cached input is typically 10% of input unless the model has no cache discount (Pro).
_LONG_CTX_5X = {
    "long_context_threshold": 272_000,
    "long_context_input": 10.0,
    "long_context_output": 45.0,
    "long_context_cached_input": 1.0,
}
_LONG_CTX_TERRA = {
    "long_context_threshold": 272_000,
    "long_context_input": 5.0,
    "long_context_output": 22.5,
    "long_context_cached_input": 0.5,
}
_LONG_CTX_LUNA = {
    "long_context_threshold": 272_000,
    "long_context_input": 2.0,
    "long_context_output": 9.0,
    "long_context_cached_input": 0.2,
}

OPENAI_PRICING: dict[str, dict[str, float]] = {
    # Pro: no cached-input discount (OpenAI docs).
    "gpt-5.5-pro": {"input": 30.0, "output": 180.0, "cached_input": 30.0},
    "gpt-5.4-pro": {"input": 30.0, "output": 180.0, "cached_input": 30.0},
    "gpt-5.6-sol": {
        "input": 5.0,
        "output": 30.0,
        "cached_input": 0.5,
        **_LONG_CTX_5X,
    },
    "gpt-5.6-terra": {
        "input": 2.5,
        "output": 15.0,
        "cached_input": 0.25,
        **_LONG_CTX_TERRA,
    },
    "gpt-5.6-luna": {
        "input": 1.0,
        "output": 6.0,
        "cached_input": 0.1,
        **_LONG_CTX_LUNA,
    },
    # Alias `gpt-5.6` routes to Sol.
    "gpt-5.6": {
        "input": 5.0,
        "output": 30.0,
        "cached_input": 0.5,
        **_LONG_CTX_5X,
    },
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
    "gpt-5.3-codex": {"input": 1.75, "output": 14.0, "cached_input": 0.175},
    "gpt-5.3": {"input": 1.75, "output": 14.0, "cached_input": 0.175},
    "gpt-5.2-codex": {"input": 1.75, "output": 14.0, "cached_input": 0.175},
    "gpt-5.2": {"input": 1.75, "output": 14.0, "cached_input": 0.175},
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
    # Fable/Mythos: $10/$50 + cache write 1.25× / cache read 0.1× (Anthropic list).
    "claude-fable-5": {"input": 10.0, "output": 50.0, "cached_input": 1.0, "cache_write": 12.5},
    "claude-mythos-5": {"input": 10.0, "output": 50.0, "cached_input": 1.0, "cache_write": 12.5},
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


def _pricing_table(provider: str) -> dict[str, dict[str, float]]:
    return ANTHROPIC_PRICING if provider == "anthropic" else OPENAI_PRICING


def _pricing_for_model(model: str | None, provider: str = "openai") -> dict[str, float]:
    name = (model or "").strip().lower()
    table = _pricing_table(provider)
    # Prefer longest prefix match so gpt-5.5-pro beats gpt-5.5, gpt-5.6-sol beats gpt-5.6.
    for key in sorted(table.keys(), key=len, reverse=True):
        if name == key or name.startswith(key + "-") or name.startswith(key):
            return table[key]
    for key in sorted(table.keys(), key=len, reverse=True):
        if key in name:
            return table[key]
    if provider == "anthropic":
        return {"input": 3.0, "output": 15.0}
    return {"input": 2.5, "output": 10.0}


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


def estimate_cost_usd(
    model: str | None,
    usage: dict[str, int] | None,
    *,
    provider: str = "openai",
) -> float | None:
    if not usage:
        return None
    input_tokens = int(usage.get("input_tokens") or 0)
    output_tokens = int(usage.get("output_tokens") or 0)
    cached_input = int(usage.get("cached_input_tokens") or usage.get("cache_read_input_tokens") or 0)
    cache_creation = int(usage.get("cache_creation_input_tokens") or 0)
    if input_tokens == 0 and output_tokens == 0 and cached_input == 0 and cache_creation == 0:
        return None
    prices = _pricing_for_model(model, provider)
    if input_tokens > int(prices.get("long_context_threshold") or 0):
        prices = {
            **prices,
            "input": prices.get("long_context_input", prices["input"]),
            "output": prices.get("long_context_output", prices["output"]),
            "cached_input": prices.get("long_context_cached_input", prices.get("cached_input", prices["input"])),
        }
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
            call_cost = estimate_cost_usd(model, usage, provider=provider or "openai")
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
    provider = entry.get("provider") or "openai"
    if usage and str(model or "").lower().startswith("claude-fable-5"):
        # Early Fable 5 rows were recorded with placeholder Haiku-like pricing.
        return estimate_cost_usd(model, usage, provider=provider)
    if entry.get("cost_usd") is not None:
        try:
            return float(entry["cost_usd"])
        except (TypeError, ValueError):
            pass
    if not usage:
        return None
    return estimate_cost_usd(
        model,
        usage,
        provider=provider,
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
    tracked = 0
    providers_seen: list[str] = []
    models_seen: list[str] = []
    model_breakdown: dict[str, dict[str, Any]] = {}
    for entry in entries:
        usage = entry.get("usage") or {}
        entry_cost = entry_effective_cost(entry)
        if entry_cost is None and not usage:
            continue
        tracked += 1
        for key in totals:
            totals[key] += int(usage.get(key) or 0)
        entry_cost = float(entry_cost or 0)
        cost_usd += entry_cost
        prov = (entry.get("provider") or "openai").lower()
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
        if prov == "openai":
            openai_cost_usd += entry_cost
        elif prov == "anthropic":
            anthropic_cost_usd += entry_cost
    # Dominant provider: whichever has the most spend
    dominant_provider: str | None = None
    if providers_seen:
        dominant_provider = max(providers_seen, key=lambda p: anthropic_cost_usd if p == "anthropic" else openai_cost_usd)
    dominant_model = models_seen[0] if len(models_seen) == 1 else (", ".join(models_seen) if models_seen else None)
    return {
        "prompt_count": len(entries),
        "tracked_count": tracked,
        "untracked_count": max(0, len(entries) - tracked),
        "usage": totals,
        "cost_usd": round(cost_usd, 4),
        "openai_cost_usd": round(openai_cost_usd, 4),
        "anthropic_cost_usd": round(anthropic_cost_usd, 4),
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
