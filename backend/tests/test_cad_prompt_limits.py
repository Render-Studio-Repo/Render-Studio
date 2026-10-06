"""CAD generate/improve accept production-length specs (not an Astra quota)."""

from __future__ import annotations

import unittest

from pydantic import ValidationError

from backend.config import CAD_PROMPT_MAX_CHARS


class CadPromptLimitTests(unittest.TestCase):
    def test_cap_is_well_above_legacy_8000(self) -> None:
        self.assertGreaterEqual(CAD_PROMPT_MAX_CHARS, 32_000)

    def test_prompt_request_accepts_openarm_scale_spec(self) -> None:
        from backend.main import ImprovePromptRequest, PromptRequest

        text = ("OpenArm mobile base: parametric differential-drive chassis. " * 160).strip()
        self.assertGreater(len(text), 8000)
        self.assertLess(len(text), CAD_PROMPT_MAX_CHARS)
        PromptRequest(prompt=text, original_prompt=text)
        ImprovePromptRequest(prompt=text)
        PromptRequest(prompt="bracket", use_mcmaster_parts=False)
        ImprovePromptRequest(prompt="clip", use_mcmaster_parts=False)

    def test_prompt_request_still_rejects_absurd_payloads(self) -> None:
        from backend.main import PromptRequest

        with self.assertRaises(ValidationError):
            PromptRequest(prompt="x" * (CAD_PROMPT_MAX_CHARS + 1))


if __name__ == "__main__":
    unittest.main()
