"""VibeCAD design review: one brief, then construct — not a 200-turn veto."""

from __future__ import annotations

import unittest

from backend.services.vibecad_gates import (
    MAX_DESIGN_REVIEW_PASSES,
    assert_review_allows_create,
    review_construct_unlocked,
    review_has_blocking,
)


def _revise() -> dict:
    return {
        "verdict": "revise",
        "summary": "Need a revolve, not stacked cones.",
        "findings": [{"severity": "blocking", "issue": "stacked cones", "required_change": "revolve"}],
    }


class VibeCadReviewGateTests(unittest.TestCase):
    def test_new_design_requires_one_review(self) -> None:
        blocked = assert_review_allows_create({"reviewed": False}, is_edit=False)
        self.assertIsNotNone(blocked)
        self.assertEqual(blocked.get("gate"), "design_review_required")

    def test_edit_does_not_require_review(self) -> None:
        self.assertIsNone(assert_review_allows_create({"reviewed": False}, is_edit=True))

    def test_revise_verdict_does_not_veto_create_after_review(self) -> None:
        state = {"reviewed": True, "review": _revise(), "review_passes": 1}
        self.assertTrue(review_has_blocking(state["review"]))
        self.assertIsNone(assert_review_allows_create(state, is_edit=False))

    def test_two_passes_unlocks_construct(self) -> None:
        state = {
            "reviewed": True,
            "review": _revise(),
            "review_passes": MAX_DESIGN_REVIEW_PASSES,
        }
        self.assertTrue(review_construct_unlocked(state))
        self.assertIsNone(assert_review_allows_create(state, is_edit=False))


if __name__ == "__main__":
    unittest.main()
