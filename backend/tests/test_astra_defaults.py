"""Model defaults/routing without loading the app or calling paid services."""
from __future__ import annotations

import ast
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from backend.config import DEFAULT_OPENAI_MODEL
from backend.services.ai_service import AIService, uses_openai_responses_api, is_openai_frontier_model
from backend.services.chatgpt_subscription_ai import ChatgptSubscriptionAI, ai_uses_codex_cli
from backend.services.codex_agent import resolve_codex_cli_model


class RouteError(Exception):
    def __init__(self, status_code, detail):
        self.status_code = status_code
        super().__init__(detail)


def route_scope():
    names = {
        "_codex_api_id_is_cli_only", "_chatgpt_codex_source", "_chatgpt_picker_model",
        "_is_gpt6_astra_model", "_is_gpt61_sol_model", "_is_gpt56_family_model", "_chatgpt_codex_cli_model",
        "_openai_authoring_model", "_get_ai_for_user",
    }
    tree = ast.parse((Path(__file__).parents[1] / "main.py").read_text())
    module = ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names], type_ignores=[])
    scope = {
        "Any": object, "AIService": Mock(side_effect=lambda **kw: SimpleNamespace(**kw)),
        "DEFAULT_OPENAI_MODEL": DEFAULT_OPENAI_MODEL,
        "settings": SimpleNamespace(openai_model=DEFAULT_OPENAI_MODEL, openai_model_quality=DEFAULT_OPENAI_MODEL),
        "HTTPException": RouteError,
        "_cursor_source": lambda s: s == "cursor", "_claude_source": lambda s: s == "claude",
        "_chatgpt_codex_available": Mock(return_value=True),
        "_chatgpt_subscription_ai": Mock(return_value="subscription"),
        "_platform_ai_for_user": Mock(return_value="platform"),
        "_is_a1projects_admin": lambda u: False,
        "_daily_ai_usage_for_user": Mock(return_value={"tokens": 10}),
        "_chatgpt_access_error": lambda u: RouteError(403, "Access denied"),
        "user_ai_keys_service": SimpleNamespace(
            resolve_key_for_user=Mock(return_value={"api_key":"fake-test-key", "provider":"openai", "source":"personal"}),
        ),
    }
    exec(compile(module, "model-routing", "exec"), scope)
    return scope


class AstraDefaultsTests(unittest.TestCase):
    def test_shared_default_and_responses(self):
        self.assertEqual(DEFAULT_OPENAI_MODEL, "gpt-6-astra")
        self.assertTrue(uses_openai_responses_api(DEFAULT_OPENAI_MODEL))
        self.assertTrue(is_openai_frontier_model(DEFAULT_OPENAI_MODEL))
        self.assertTrue(uses_openai_responses_api("gpt-6.1-sol"))
        self.assertTrue(is_openai_frontier_model("gpt-6.1-sol"))
        self.assertFalse(uses_openai_responses_api("gpt-4o-mini"))
        self.assertEqual(ChatgptSubscriptionAI("test").model, DEFAULT_OPENAI_MODEL)

    def test_cli_default_preserves_environment_and_explicit_choices(self):
        with patch.dict("os.environ", {"CODEX_MODEL":"", "RENDER3D_CODEX_MODEL":""}):
            self.assertEqual(resolve_codex_cli_model(), DEFAULT_OPENAI_MODEL)
            self.assertEqual(resolve_codex_cli_model("chatgpt"), DEFAULT_OPENAI_MODEL)
            self.assertEqual(resolve_codex_cli_model("gpt-5.6-luna", api_key_auth=True), "gpt-5.6-luna")
        with patch.dict("os.environ", {"CODEX_MODEL":"gpt-5.6-terra"}):
            self.assertEqual(resolve_codex_cli_model(api_key_auth=True), "gpt-5.6-terra")

    def test_gpt61_sol_accepts_documented_reasoning_efforts(self):
        ai = AIService.__new__(AIService)
        ai.provider = "openai"
        ai.model = "gpt-6.1-sol"
        self.assertEqual(ai._reasoning_param("low")["reasoning"]["effort"], "low")
        self.assertEqual(ai._reasoning_param("max")["reasoning"]["effort"], "max")
        self.assertEqual(ai._reasoning_param("none")["reasoning"]["effort"], "medium")

    def test_platform_default_uses_astra_but_preserves_configured_model(self):
        from backend.services import ai_credit_service
        with patch.object(ai_credit_service.settings, "openai_model", ""):
            self.assertEqual(ai_credit_service._default_platform_model("openai", speed="fast"), DEFAULT_OPENAI_MODEL)
        with patch.object(ai_credit_service.settings, "openai_model", "gpt-5.6-luna"):
            self.assertEqual(ai_credit_service._default_platform_model("openai", speed="fast"), "gpt-5.6-luna")

    def test_default_does_not_override_explicit_model(self):
        scope = route_scope()
        pick = scope["_chatgpt_picker_model"]
        for legacy in (None, "", "default", "codex", "chatgpt"):
            self.assertEqual(pick(legacy), DEFAULT_OPENAI_MODEL)
        self.assertEqual(pick("gpt-5.6-luna"), "gpt-5.6-luna")
        self.assertTrue(scope["_chatgpt_codex_cli_model"]("gpt-6.1-sol"))
        self.assertFalse(scope["_codex_api_id_is_cli_only"](DEFAULT_OPENAI_MODEL))
        self.assertEqual(scope["_openai_authoring_model"](key_model=None, requested_model=DEFAULT_OPENAI_MODEL, speed="quality"), DEFAULT_OPENAI_MODEL)

    def test_byok_astra_does_not_silently_use_subscription(self):
        scope = route_scope()
        ai = scope["_get_ai_for_user"]({"id":"test"}, key_id="own", key_source="personal", requested_model=DEFAULT_OPENAI_MODEL)
        self.assertEqual(ai.model, DEFAULT_OPENAI_MODEL)
        scope["_chatgpt_subscription_ai"].assert_not_called()
        self.assertFalse(ai_uses_codex_cli(ai))

    def test_platform_source_stays_platform(self):
        scope = route_scope()
        self.assertEqual(scope["_get_ai_for_user"]({"id":"test"}, key_source="platform", requested_model=DEFAULT_OPENAI_MODEL), "platform")
        scope["_platform_ai_for_user"].assert_called_once()
        scope["_chatgpt_subscription_ai"].assert_not_called()

    def test_subscription_default_and_denied_access(self):
        scope = route_scope()
        self.assertEqual(scope["_get_ai_for_user"]({"id":"test"}, key_source="chatgpt"), "subscription")
        scope["_chatgpt_subscription_ai"].assert_called_once_with({"id":"test"}, DEFAULT_OPENAI_MODEL, consume_trial=False)
        scope["_chatgpt_codex_available"].return_value = False
        with self.assertRaises(RouteError) as error:
            scope["_get_ai_for_user"]({"id":"test"}, key_source="chatgpt")
        self.assertEqual(error.exception.status_code, 403)

    def test_team_limits_still_apply_to_astra(self):
        scope = route_scope()
        scope["user_ai_keys_service"].resolve_key_for_user.return_value = {
            "api_key":"fake-test-key", "provider":"openai", "source":"team", "daily_token_limit":10,
        }
        with self.assertRaises(RouteError) as error:
            scope["_get_ai_for_user"]({"id":"test"}, key_id="team", requested_model=DEFAULT_OPENAI_MODEL)
        self.assertEqual(error.exception.status_code, 402)


if __name__ == "__main__":
    unittest.main()
