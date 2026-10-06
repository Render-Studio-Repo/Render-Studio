"""Stub AI client for CAD jobs billed through a ChatGPT / Codex CLI login.

ChatGPT Plus/Pro and OpenAI API keys run ``codex exec``. Claude is not this
path — desktop VibeCAD talks to Anthropic with an API key, and so does Render.
"""

from __future__ import annotations

import json
from typing import Any

from backend.config import DEFAULT_OPENAI_MODEL
from backend.services.chatgpt_codex_llm import complete as codex_complete
from backend.services.prompt_language import with_multilingual_prompt_rule


def is_gpt6_astra_model(model: str | None) -> bool:
    return str(model or "").strip().lower().startswith("gpt-6-astra")


def ai_uses_codex_cli(ai: Any) -> bool:
    return str(getattr(ai, "billing_source", "") or "") == "chatgpt_subscription"


def codex_model_short_name(model: str | None) -> str:
    m = str(model or "").strip().lower()
    if m.startswith("gpt-6-astra-pro"):
        return "GPT-6 Astra Pro"
    if m.startswith("gpt-6-astra"):
        return "GPT-6 Astra"
    if m.startswith("gpt-6.1-sol"):
        return "GPT-6.1 Sol"
    if m.startswith("gpt-5.6-sol"):
        return "GPT-5.6 Sol"
    if m.startswith("gpt-5.6-luna"):
        return "GPT-5.6 Luna"
    if m.startswith("gpt-5.6-terra"):
        return "GPT-5.6 Terra"
    if m in {"", "chatgpt", "codex", "default", "chatgpt-default"}:
        return "Codex"
    return str(model or "Codex").strip() or "Codex"


class ChatgptSubscriptionAI:
    """Looks like AIService enough for the design pipeline; LLM calls go through Codex."""

    provider = "openai"
    model = DEFAULT_OPENAI_MODEL
    api_key = ""
    billing_source = "chatgpt_subscription"

    def __init__(self, user_id: str, model: str | None = None) -> None:
        self.billing_user_id = str(user_id or "")
        self.model = str(model or "").strip() or DEFAULT_OPENAI_MODEL
        self.cancel_check = None
        self.usage_callback = None
        self.client = None
        self.reasoning_effort = None

    def set_cancel_check(self, cancel_check) -> None:
        self.cancel_check = cancel_check

    def set_usage_callback(self, usage_callback) -> None:
        self.usage_callback = usage_callback

    def _canceled(self) -> bool:
        return bool(self.cancel_check and self.cancel_check())

    def _emit_usage(self, usage: dict[str, int]) -> None:
        if not self.usage_callback:
            return
        from backend.services.chatgpt_codex_llm import trace_for_codex_usage

        try:
            self.usage_callback(trace_for_codex_usage(self.model, usage))
        except Exception:
            pass

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
        return codex_complete(
            user_id=self.billing_user_id,
            system_prompt=system_prompt,
            user_content=user_content,
            images=images,
            json_response=json_response,
            trace_id=trace_id,
            model=self.model,
            reasoning_effort=self.reasoning_effort,
            usage_callback=self._emit_usage,
            cancel_check=self.cancel_check,
        )

    def _parse_json_object(self, raw: str) -> dict[str, Any]:
        from backend.services.ai_service import AIService

        try:
            parsed = json.loads(AIService._json_payload(raw))
        except json.JSONDecodeError as exc:
            raise ValueError(f"AI returned invalid JSON: {(raw or '')[:500]}") from exc
        if not isinstance(parsed, dict):
            raise ValueError("AI returned JSON that was not an object.")
        return parsed

    def generate_wiring(
        self,
        user_prompt: str,
        trace_id: str | None = None,
        images: list[dict[str, Any]] | None = None,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        from backend.services.wiring_service import WIRING_SYSTEM_PROMPT

        raw, call_trace = self._call_model(
            WIRING_SYSTEM_PROMPT,
            user_prompt,
            trace_id=trace_id,
            images=images,
            json_response=True,
        )
        schematic = self._parse_json_object(raw)
        if isinstance(call_trace, dict):
            call_trace["parsed_ok"] = True
            call_trace["component_count"] = len(schematic.get("components") or [])
            call_trace["wire_count"] = len(schematic.get("wires") or [])
        return schematic, call_trace

    def diagnose_wiring_photo(
        self,
        user_prompt: str,
        images: list[dict[str, Any]],
        trace_id: str | None = None,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        from backend.services.wiring_service import CIRCUIT_DEBUG_SYSTEM_PROMPT

        raw, call_trace = self._call_model(
            CIRCUIT_DEBUG_SYSTEM_PROMPT,
            user_prompt,
            trace_id=trace_id,
            images=images,
            json_response=True,
        )
        diagnosis = self._parse_json_object(raw)
        if isinstance(call_trace, dict):
            call_trace["parsed_ok"] = True
            call_trace["issue_count"] = len(diagnosis.get("issues") or [])
        return diagnosis, call_trace

    def generate_rigging(
        self,
        user_prompt: str,
        trace_id: str | None = None,
        images: list[dict[str, Any]] | None = None,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        from backend.services.ai_service import cad_authoring_max_tokens
        from backend.services.rigging_service import RIGGING_SYSTEM_PROMPT

        raw, call_trace = self._call_model(
            RIGGING_SYSTEM_PROMPT,
            user_prompt,
            trace_id=trace_id,
            images=images,
            max_tokens=cad_authoring_max_tokens(self.model),
            json_response=True,
        )
        rig = self._parse_json_object(raw)
        if isinstance(call_trace, dict):
            call_trace["parsed_ok"] = True
            call_trace["bone_count"] = len(rig.get("bones") or [])
            call_trace["animation_count"] = len(rig.get("animations") or [])
        return rig, call_trace

    def generate_cad_brief(
        self,
        user_prompt: str,
        project_context: dict[str, Any] | None = None,
        trace_id: str | None = None,
        images: list[dict[str, Any]] | None = None,
    ) -> tuple[str, dict[str, Any]]:
        """Same CAD-brief contract as the HTTP path — Astra used to skip this and ignore photos/files."""
        from backend.services.ai_service import build_cad_brief_prompts, cad_authoring_max_tokens

        system, user = build_cad_brief_prompts(user_prompt, project_context)
        raw, trace = self._call_model(
            system,
            user,
            trace_id=trace_id,
            images=images,
            max_tokens=cad_authoring_max_tokens(self.model),
            json_response=False,
            allow_truncated=True,
        )
        brief = (raw or "").strip()
        if not brief.lower().startswith("cad brief"):
            brief = f"CAD brief:\n{brief}"
        if isinstance(trace, dict):
            trace["stage"] = "cad_brief"
        return brief, trace

    def chat_json(
        self,
        system_prompt: str,
        user_content: str,
        *,
        images: list[dict[str, Any]] | None = None,
        trace_id: str | None = None,
        max_tokens: int = 16384,
        allow_truncated: bool = False,
        reasoning_effort: str | None = None,
        **_kwargs: Any,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        """Same contract as AIService.chat_json — snapshot / VibeCAD visual review."""
        _ = reasoning_effort
        raw, call_trace = self._call_model(
            system_prompt,
            user_content,
            trace_id=trace_id,
            images=images,
            max_tokens=max_tokens,
            json_response=True,
            allow_truncated=allow_truncated,
        )
        parsed = self._parse_json_object(raw)
        if isinstance(call_trace, dict):
            call_trace["parsed_ok"] = True
            return parsed, call_trace
        return parsed, {}

    def generate_drawing_package_from_images(
        self,
        prompt: str,
        images: list[dict[str, Any]] | None = None,
        trace_id: str | None = None,
    ) -> tuple[str, str, dict[str, Any]]:
        from backend.services.prompt_references import DRAWING_PACKAGE_MIXED_REF_RULE

        system = with_multilingual_prompt_rule(
            "You are an expert CAD drafter and mechanical designer. The user uploaded reference image(s). "
            "Read them WITH the prompt. Convert into:\n"
            "1) A clear CAD drawing brief (natural language) that a downstream text-to-CAD agent can follow, and\n"
            "2) A DXF (Drawing eXchange Format) of the key 2D geometry of the NEW PART only.\n"
            + DRAWING_PACKAGE_MIXED_REF_RULE
            + "\n"
            "Output EXACTLY in this format (no markdown fences):\n"
            "===DRAWING_PROMPT===\n"
            "<multi-sentence brief: overall shape, materials if visible, estimated mm dimensions, "
            "hole/pattern counts, features to model, origin/orientation assumptions, and how to interpret the photo>\n"
            "===DXF===\n"
            "<valid DXF text starting with HEADER section (0\\nSECTION\\n2\\nHEADER) and ending with EOF>\n\n"
            "Estimate millimetre dimensions from visual proportions and any scale cues. "
            "Use layers OUTLINE, HOLES, DIMENSIONS, ANNOTATIONS. "
            "Include visible holes as CIRCLE entities and outlines as LINE/LWPOLYLINE/ARC. "
            "The drawing prompt must incorporate and extend the user's request — do not ignore their prompt."
        )
        user = (
            f"User prompt: {prompt}\n\n"
            "Analyze the attached image(s). Write the drawing prompt and DXF as specified."
        )
        raw, trace = self._call_model(
            system,
            user,
            trace_id=trace_id,
            images=images,
            json_response=False,
        )
        text = str(raw or "").strip()
        if text.startswith("```"):
            text = text.strip("`")
            if text.lower().startswith("dxf"):
                text = text[3:].lstrip()
        drawing_prompt = ""
        dxf_text = ""
        if "===DRAWING_PROMPT===" in text and "===DXF===" in text:
            after_brief = text.split("===DRAWING_PROMPT===", 1)[1]
            drawing_prompt, dxf_part = after_brief.split("===DXF===", 1)
            drawing_prompt = drawing_prompt.strip()
            dxf_text = dxf_part.strip()
        elif "===DXF===" in text:
            before, dxf_part = text.split("===DXF===", 1)
            drawing_prompt = before.replace("===DRAWING_PROMPT===", "").strip()
            dxf_text = dxf_part.strip()
        elif "0\nSECTION" in text or "0\r\nSECTION" in text:
            dxf_text = text
        else:
            drawing_prompt = text
        if not drawing_prompt and not dxf_text:
            raise RuntimeError("ChatGPT/Codex did not return a drawing prompt or DXF.")
        return dxf_text, drawing_prompt, trace

    def generate_cad_python_source(self, *args: Any, **kwargs: Any) -> Any:
        from backend.services.ai_service import AIService

        return AIService.generate_cad_python_source(self, *args, **kwargs)

    def _python_payload(self, raw: str) -> str:
        from backend.services.ai_service import AIService

        return AIService._python_payload(raw)

    def generate_step_module(self, *_args: Any, **_kwargs: Any) -> Any:
        raise RuntimeError(
            "This ChatGPT subscription runs CAD through Codex CLI. "
            "STEP modules need an API key if Codex cannot author them."
        )

    def generate_design(self, *_args: Any, **_kwargs: Any) -> Any:
        raise RuntimeError(
            "This ChatGPT subscription runs CAD through Codex CLI, not the OpenAI API. "
            "Use CAD 2.0, VibeCAD, or Mesh, or add an API key for Render."
        )
