from types import SimpleNamespace

from backend.services.model_reasoning import (
    configure_ai_reasoning,
    normalize_reasoning_effort,
    reasoning_efforts,
)


def test_reasoning_capabilities_are_model_specific():
    assert reasoning_efforts("openai", "gpt-6.1-sol") == ("auto", "low", "medium", "high")
    assert reasoning_efforts("gemini", "gemini-3.8-flash") == ("auto", "low", "medium", "high")
    assert reasoning_efforts("kimi", "kimi-k3") == ("auto", "low", "medium", "high")
    assert reasoning_efforts("anthropic", "claude-fable-5-1") == ("auto",)


def test_unsupported_effort_becomes_provider_default():
    assert normalize_reasoning_effort("anthropic", "claude-fable-5-1", "high") is None
    assert normalize_reasoning_effort("openai", "gpt-6.1-sol", "auto") is None
    assert normalize_reasoning_effort("openai", "gpt-6.1-sol", "high") == "high"


def test_configure_ai_reasoning_cannot_reuse_another_models_effort():
    openai = configure_ai_reasoning(SimpleNamespace(provider="openai", model="gpt-6.1-sol"), "high")
    claude = configure_ai_reasoning(SimpleNamespace(provider="anthropic", model="claude-fable-5-1"), "high")
    assert openai.reasoning_effort == "high"
    assert claude.reasoning_effort is None


def test_openai_service_uses_configured_effort_without_call_override():
    from backend.services.ai_service import AIService

    ai = AIService.__new__(AIService)
    ai.provider = "openai"
    ai.model = "gpt-6.1-sol"
    ai.reasoning_effort = "high"
    assert ai._reasoning_param()["reasoning"]["effort"] == "high"


def test_kimi_k3_uses_selected_effort():
    from backend.services.ai_service import kimi_chat_create_kwargs

    assert kimi_chat_create_kwargs("kimi-k3", max_tokens=1000, reasoning_effort="low")["reasoning_effort"] == "low"
