"""AI prompt systems accept user requests in any language."""

from __future__ import annotations

import unittest

from backend.main import (
    IMPROVE_CAD_PROMPT_SYSTEM,
    IMPROVE_IMAGINE_PROMPT_SYSTEM,
    IMPROVE_MESH_PROMPT_SYSTEM,
    IMPROVE_RENDER_PROMPT_SYSTEM,
)
from backend.services.ai_service import DESIGN_SYSTEM_PROMPT
from backend.services.mesh_service import MESH_SYSTEM
from backend.services.prompt_language import (
    MULTILINGUAL_USER_PROMPT_RULE,
    with_multilingual_prompt_rule,
)
from backend.services.vibecad_service import VIBECAD_SYSTEM


class MultilingualPromptTests(unittest.TestCase):
    def test_shared_rule_covers_any_language(self) -> None:
        lower = MULTILINGUAL_USER_PROMPT_RULE.lower()
        self.assertIn("any language", lower)
        self.assertIn("do not require english", lower)
        self.assertIn("mixed languages", lower)

    def test_rule_is_idempotent(self) -> None:
        once = with_multilingual_prompt_rule("You rewrite prompts.")
        twice = with_multilingual_prompt_rule(once)
        self.assertEqual(once.count("LANGUAGE — The user prompt may be in any language"), 1)
        self.assertEqual(twice, once)

    def test_improve_and_generation_systems_include_language_rule(self) -> None:
        for text in (
            IMPROVE_CAD_PROMPT_SYSTEM,
            IMPROVE_RENDER_PROMPT_SYSTEM,
            IMPROVE_IMAGINE_PROMPT_SYSTEM,
            IMPROVE_MESH_PROMPT_SYSTEM,
            DESIGN_SYSTEM_PROMPT,
            MESH_SYSTEM,
            VIBECAD_SYSTEM,
        ):
            lower = text.lower()
            self.assertIn("any language", lower, msg=text[:80])
            self.assertIn("do not require english", lower, msg=text[:80])


if __name__ == "__main__":
    unittest.main()
