"""CAD host picker: Codex for ChatGPT/OpenAI, vendor HTTP for Claude-class keys.

ChatGPT subscription and OpenAI API keys run one Codex session (desktop VibeCAD
does the same). Anthropic, Gemini, Qwen, and Kimi use that provider's API
directly — VibeCAD's Claude path is an Anthropic key, not Claude.ai OAuth.
Do not wrap either path in a homemade JSON tool agent.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class CodexLaunch:
    """How to start ``codex exec`` for this user + selected AI."""

    home: Path
    cli_model: str | None
    extra_cli: list[str] = field(default_factory=list)
    env: dict[str, str] = field(default_factory=dict)
    pop_openai_key: bool = True
    auth_label: str = "chatgpt"


def ai_is_chatgpt_codex(ai: Any) -> bool:
    from backend.services.chatgpt_subscription_ai import ai_uses_codex_cli

    return bool(ai_uses_codex_cli(ai))


def _provider(ai: Any) -> str:
    return str(getattr(ai, "provider", "") or "openai").strip().lower()


def _api_key(ai: Any) -> str:
    return str(getattr(ai, "api_key", "") or "").strip()


_DIRECT_HTTP_PROVIDERS = {
    "anthropic",
    "claude",
    "gemini",
    "google",
    "qwen",
    "dashscope",
    "alibaba",
    "kimi",
    "moonshot",
}


def ai_uses_direct_http(ai: Any) -> bool:
    """Claude/Gemini/Qwen/Kimi: VibeCAD talks to the vendor API, not Codex."""
    return _provider(ai) in _DIRECT_HTTP_PROVIDERS


def _user_id(ai: Any, user_id: str | None) -> str:
    # Prefer the ChatGPT/Codex owner (shared team login or trial host), not the
    # requester. Passing the requester here looks up an empty CODEX_HOME and
    # fails with "Sign in with ChatGPT" after the brief already billed the owner.
    return str(getattr(ai, "billing_user_id", "") or user_id or "").strip()


def _chatgpt_home(user_id: str | None) -> Path | None:
    from backend.services.codex_agent import _codex_home_for_user

    uid = str(user_id or "").strip()
    if not uid:
        return None
    return _codex_home_for_user(uid)


def _api_key_home(user_id: str) -> Path:
    from backend.services.chatgpt_codex_auth import _link_shared_codex_assets, user_codex_home

    root = user_codex_home(user_id) / "api-openai"
    root.mkdir(parents=True, exist_ok=True)
    _link_shared_codex_assets(root)
    cfg = root / "config.toml"
    if not cfg.is_file():
        cfg.write_text(
            'preferred_auth_method = "apikey"\ncli_auth_credentials_store = "file"\n',
            encoding="utf-8",
        )
    return root


def resolve_codex_launch(
    ai: Any,
    *,
    user_id: str | None = None,
    project_path: Path | None = None,
) -> CodexLaunch:
    """Pick ChatGPT device-auth or an OpenAI API key. Codex is always the host."""
    from backend.services.codex_agent import (
        CodexUnavailable,
        resolve_codex_bin,
        resolve_codex_cli_model,
        _trust_project_in_codex_config,
    )

    if not resolve_codex_bin():
        raise CodexUnavailable("Codex CLI not found. Install Codex or set CODEX_BIN.")

    uid = _user_id(ai, user_id)
    chatgpt_home = _chatgpt_home(uid)
    model = str(getattr(ai, "model", "") or "").strip() or None
    provider = _provider(ai)
    key = _api_key(ai)
    billing = str(getattr(ai, "billing_source", "") or "")
    reasoning_effort = str(getattr(ai, "reasoning_effort", "") or "").strip().lower()
    reasoning_cli = ["-c", f'model_reasoning_effort="{reasoning_effort}"'] if reasoning_effort in {"low", "medium", "high"} else []

    if billing == "chatgpt_subscription" or ai_is_chatgpt_codex(ai):
        if not chatgpt_home:
            raise CodexUnavailable(
                "Sign in with ChatGPT under Subscriptions so CAD can use Codex as the host."
            )
        if project_path is not None:
            _trust_project_in_codex_config(Path(project_path), chatgpt_home)
        return CodexLaunch(
            home=chatgpt_home,
            cli_model=resolve_codex_cli_model(model, home=chatgpt_home),
            env={"CODEX_HOME": str(chatgpt_home), "TERM": "dumb"},
            pop_openai_key=True,
            auth_label="chatgpt",
            extra_cli=reasoning_cli,
        )

    openai_family = provider in {"openai", "", "xai"}
    if openai_family and key:
        if not uid:
            uid = "local"
        home = _api_key_home(uid)
        if project_path is not None:
            _trust_project_in_codex_config(Path(project_path), home)
        extra: list[str] = list(reasoning_cli)
        env = {
            "CODEX_HOME": str(home),
            "TERM": "dumb",
            "OPENAI_API_KEY": key,
        }
        if provider != "xai":
            env["CODEX_API_KEY"] = key
        if provider == "xai":
            base = str(getattr(ai, "base_url", "") or "https://api.x.ai/v1").rstrip("/")
            extra = [
                "-c",
                "model_provider=\"xai\"",
                "-c",
                f'model_providers.xai.name="xAI"',
                "-c",
                f'model_providers.xai.base_url="{base}"',
                "-c",
                'model_providers.xai.env_key="OPENAI_API_KEY"',
            ]
        return CodexLaunch(
            home=home,
            cli_model=resolve_codex_cli_model(model, home=home, api_key_auth=True),
            extra_cli=extra,
            env=env,
            pop_openai_key=False,
            auth_label="openai_api",
        )

    if ai_uses_direct_http(ai):
        raise CodexUnavailable(
            "Claude, Gemini, Qwen, and Kimi use that provider's API key — the same split "
            "desktop VibeCAD uses. Add an Anthropic (or matching) API key under Subscriptions. "
            "Claude.ai Pro/Max is not a CAD login."
        )

    raise CodexUnavailable(
        "CAD uses Codex for ChatGPT / OpenAI. Sign in with ChatGPT under Subscriptions, "
        "or add an OpenAI API key."
    )


def choose_cad_host(context: dict[str, Any] | None, ai: Any, *, harness: str = "generic") -> str:
    """Codex for ChatGPT/OpenAI; Cursor/Claude CLI for those subscriptions; vendor HTTP for API keys."""
    ctx = context or {}
    kind = str(harness or "generic").strip().lower()
    billing = str(getattr(ai, "billing_source", "") or "")
    if kind == "vibecad":
        if ctx.get("vibecad_oneshot"):
            return "oneshot"
        if ctx.get("vibecad_agent") or ctx.get("use_vibecad_agent"):
            return "agent"
    elif kind == "jake":
        if ctx.get("jake_force_tool_agent"):
            return "agent"
    elif kind == "mac":
        if ctx.get("mac_langgraph"):
            return "langgraph"
    elif kind == "mesh":
        if ctx.get("mesh_llm_loop"):
            return "llm_loop"
    if billing in {"cursor_subscription", "claude_subscription"}:
        return "codex_host"
    if ai_uses_direct_http(ai):
        return "http"
    return "codex_host"


def jake_agent_flags(
    context: dict[str, Any] | None,
    ai: Any,
    *,
    jake_identical: bool,
) -> tuple[bool, bool]:
    """Return ``(use_codex_host, use_tool_agent)``."""
    if not jake_identical:
        return False, False
    host = choose_cad_host(context, ai, harness="jake")
    if host == "agent":
        return False, True
    if host == "http":
        return False, False
    return True, False


def choose_mac_runtime(context: dict[str, Any] | None, ai: Any) -> str:
    host = choose_cad_host(context, ai, harness="mac")
    if host == "langgraph":
        return "langgraph"
    if host == "http":
        return "http"
    return "codex_host"


def choose_vibecad_runtime(context: dict[str, Any] | None, ai: Any) -> str:
    host = choose_cad_host(context, ai, harness="vibecad")
    if host == "oneshot":
        return "oneshot"
    if host == "agent":
        return "agent"
    if host == "http":
        return "oneshot"
    return "codex_host"


def choose_mesh_runtime(context: dict[str, Any] | None, ai: Any) -> str:
    host = choose_cad_host(context, ai, harness="mesh")
    if host == "llm_loop":
        return "llm_loop"
    if host == "http":
        return "http"
    return "codex_host"
