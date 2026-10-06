"""CAD AI clients billed through a Cursor or Claude subscription CLI login."""

from __future__ import annotations

from typing import Any

from backend.services.chatgpt_subscription_ai import ChatgptSubscriptionAI
from backend.services.cli_subscription_llm import complete as cli_complete


CLI_SUBSCRIPTION_SOURCES = {
    "chatgpt_subscription",
    "cursor_subscription",
    "claude_subscription",
}


def ai_uses_cli_host(ai: Any) -> bool:
    billing = str(getattr(ai, "billing_source", "") or "")
    if billing in CLI_SUBSCRIPTION_SOURCES:
        return True
    from backend.services.chatgpt_subscription_ai import ai_uses_codex_cli

    return bool(ai_uses_codex_cli(ai))


def cli_host_id(ai: Any) -> str:
    billing = str(getattr(ai, "billing_source", "") or "")
    if billing == "cursor_subscription":
        return "cursor"
    if billing == "claude_subscription":
        return "claude"
    return "chatgpt"


def cli_host_label(ai: Any) -> str:
    host = cli_host_id(ai)
    if host == "cursor":
        return "Cursor"
    if host == "claude":
        return "Claude"
    from backend.services.chatgpt_subscription_ai import codex_model_short_name

    return f"Codex {codex_model_short_name(getattr(ai, 'model', None))}"


class _CliSubscriptionAI(ChatgptSubscriptionAI):
    host = "cursor"
    provider = "cursor"
    billing_source = "cursor_subscription"

    def __init__(self, user_id: str, model: str | None = None) -> None:
        super().__init__(user_id, model=model)
        if not str(self.model or "").strip() or self.model in {"chatgpt", "codex"}:
            self.model = "auto" if self.host == "cursor" else "claude-opus-4-8"

    def _call_model(
        self,
        system_prompt: str,
        user_content: str,
        *,
        trace_id: str | None = None,
        images: list[dict[str, Any]] | None = None,
        max_tokens: int | None = None,
        json_response: bool = False,
        allow_truncated: bool = False,
        **_kwargs: Any,
    ) -> tuple[str, dict[str, Any]]:
        if self._canceled():
            raise RuntimeError("Generation canceled.")
        _ = max_tokens
        _ = allow_truncated
        return cli_complete(
            host=self.host,
            user_id=self.billing_user_id,
            system_prompt=system_prompt,
            user_content=user_content,
            images=images,
            json_response=json_response,
            trace_id=trace_id,
            model=self.model,
            usage_callback=self._emit_usage,
            cancel_check=self.cancel_check,
        )

    def generate_step_module(self, *_args: Any, **_kwargs: Any) -> Any:
        raise RuntimeError(
            f"This {self.host} subscription runs CAD through the {self.host} CLI. "
            "STEP modules need an API key if that CLI cannot author them."
        )

    def generate_design(self, *_args: Any, **_kwargs: Any) -> Any:
        raise RuntimeError(
            f"This {self.host} subscription runs CAD through the {self.host} CLI. "
            "Use CAD 2.0, VibeCAD, or Mesh, or add an API key for Render."
        )


class CursorSubscriptionAI(_CliSubscriptionAI):
    host = "cursor"
    provider = "cursor"
    billing_source = "cursor_subscription"


class ClaudeSubscriptionAI(_CliSubscriptionAI):
    host = "claude"
    provider = "anthropic"
    billing_source = "claude_subscription"
