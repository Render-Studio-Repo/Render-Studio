"""OpenAI list-price estimates for Astra, Codex, and Sol."""

from __future__ import annotations

import unittest

from backend.services.ai_cost import (
    _pricing_for_model,
    estimate_cost_usd,
    should_apply_long_context,
)


class AstraCodexPricingTests(unittest.TestCase):
    def test_astra_short_context_list_price(self) -> None:
        prices = _pricing_for_model("gpt-6-astra")
        self.assertEqual(prices["input"], 10.0)
        self.assertEqual(prices["output"], 50.0)
        self.assertEqual(prices["cached_input"], 1.0)
        self.assertEqual(prices["cache_write"], 12.5)
        self.assertEqual(prices["long_context_input"], 20.0)
        self.assertEqual(prices["long_context_output"], 75.0)

    def test_astra_pro_matches_astra_list_price(self) -> None:
        self.assertEqual(
            _pricing_for_model("gpt-6-astra-pro")["input"],
            _pricing_for_model("gpt-6-astra")["input"],
        )
        self.assertEqual(
            _pricing_for_model("gpt-6-astra-pro")["output"],
            50.0,
        )
        # Must not fall through to gpt-5.5-pro $30/$180.
        self.assertNotEqual(_pricing_for_model("gpt-6-astra-pro")["input"], 30.0)

    def test_codex_list_price(self) -> None:
        prices = _pricing_for_model("gpt-5.3-codex")
        self.assertEqual(prices["input"], 1.75)
        self.assertEqual(prices["output"], 14.0)
        self.assertEqual(prices["cached_input"], 0.175)
        self.assertEqual(_pricing_for_model("chatgpt")["input"], 1.75)
        self.assertEqual(_pricing_for_model("codex")["output"], 14.0)

    def test_sol_promotional_list_price(self) -> None:
        prices = _pricing_for_model("gpt-5.6-sol")
        self.assertEqual(prices["input"], 4.0)
        self.assertEqual(prices["output"], 20.0)
        self.assertEqual(prices["cached_input"], 0.40)
        self.assertEqual(prices["cache_write"], 5.0)
        self.assertEqual(prices["long_context_output"], 30.0)

    def test_gpt61_sol_list_price(self) -> None:
        prices = _pricing_for_model("gpt-6.1-sol")
        self.assertEqual(prices["input"], 2.0)
        self.assertEqual(prices["output"], 10.0)
        self.assertEqual(prices["cached_input"], 0.10)
        self.assertEqual(prices["cache_write"], 2.5)
        self.assertEqual(prices["long_context_input"], 4.0)
        self.assertEqual(prices["long_context_output"], 15.0)

    def test_b2e6b413_astra_session_matches_short_context_math(self) -> None:
        usage = {
            "input_tokens": 2_911_517,
            "output_tokens": 86_651,
            "cached_input_tokens": 2_651_392,
            "reasoning_tokens": 15_539,
        }
        # Reasoning is a subset of output_tokens — do not bill it twice.
        cost = estimate_cost_usd("gpt-6-astra", usage)
        billable = 2_911_517 - 2_651_392
        expected = round(
            billable * 10.0 / 1_000_000
            + 2_651_392 * 1.0 / 1_000_000
            + 86_651 * 50.0 / 1_000_000,
            6,
        )
        self.assertEqual(cost, expected)
        self.assertAlmostEqual(cost, 9.585192, places=5)

    def test_astra_session_does_not_apply_long_context(self) -> None:
        usage = {
            "input_tokens": 300_000,
            "output_tokens": 1_000,
            "cached_input_tokens": 0,
        }
        self.assertFalse(should_apply_long_context("gpt-6-astra"))
        short = estimate_cost_usd("gpt-6-astra", usage)
        forced_long = estimate_cost_usd(
            "gpt-6-astra", usage, apply_long_context=True
        )
        self.assertEqual(short, round(300_000 * 10.0 / 1_000_000 + 1_000 * 50.0 / 1_000_000, 6))
        self.assertEqual(
            forced_long,
            round(300_000 * 20.0 / 1_000_000 + 1_000 * 75.0 / 1_000_000, 6),
        )
        self.assertGreater(forced_long, short)

    def test_sol_http_applies_long_context(self) -> None:
        usage = {"input_tokens": 300_000, "output_tokens": 1_000}
        self.assertTrue(should_apply_long_context("gpt-5.6-sol"))
        cost = estimate_cost_usd("gpt-5.6-sol", usage)
        self.assertEqual(
            cost,
            round(300_000 * 8.0 / 1_000_000 + 1_000 * 30.0 / 1_000_000, 6),
        )

    def test_chatgpt_subscription_meta_skips_long_context(self) -> None:
        self.assertFalse(
            should_apply_long_context(
                "gpt-5.6-sol",
                {"billing_source": "chatgpt_subscription"},
            )
        )


class UsageSummaryAttributionTests(unittest.TestCase):
    def test_claude_mistagged_as_openai_is_priced_and_split_as_anthropic(self) -> None:
        from backend.services.ai_cost import summarize_entries

        usage = {"input_tokens": 100_000, "output_tokens": 10_000}
        summary = summarize_entries(
            [
                {
                    "prompt": "cad",
                    "trace_id": "t1",
                    "created_at": "2026-09-03T12:00:00Z",
                    "model": "claude-fable-5-1",
                    "provider": "openai",
                    "usage": usage,
                    "cost_usd": 0.65,  # old OpenAI-default $5/$30 math
                }
            ]
        )
        self.assertAlmostEqual(summary["anthropic_cost_usd"], 1.5, places=4)
        self.assertEqual(summary["openai_cost_usd"], 0.0)
        self.assertEqual(summary["cost_usd"], summary["anthropic_cost_usd"])
        self.assertEqual(summary["cost_basis"], "estimated_list_price")

    def test_chatgpt_plan_is_not_lumped_into_openai_api(self) -> None:
        from backend.services.ai_cost import summarize_entries

        usage = {"input_tokens": 1_000_000, "output_tokens": 0}
        summary = summarize_entries(
            [
                {
                    "prompt": "via chatgpt",
                    "trace_id": "t2",
                    "created_at": "2026-09-04T12:00:00Z",
                    "model": "gpt-5.6-sol",
                    "provider": "openai",
                    "key_source": "chatgpt",
                    "usage": usage,
                    "cost_usd": 4.0,
                }
            ]
        )
        self.assertEqual(summary["chatgpt_cost_usd"], 4.0)
        self.assertEqual(summary["openai_cost_usd"], 0.0)
        self.assertEqual(summary["cost_usd"], 4.0)

    def test_legacy_rows_count_only_on_solo_projects(self) -> None:
        from backend.services.ai_cost import entries_attributed_to_user

        sam = "user-sam"
        other = "user-other"
        legacy = {"prompt": "old", "user_id": None, "cost_usd": 1}
        sam_row = {"prompt": "mine", "user_id": sam, "cost_usd": 2}
        other_row = {"prompt": "theirs", "user_id": other, "cost_usd": 9}
        solo = entries_attributed_to_user([legacy, sam_row], sam)
        self.assertEqual(len(solo), 2)
        shared = entries_attributed_to_user([legacy, sam_row, other_row], sam)
        self.assertEqual([e["prompt"] for e in shared], ["mine"])

    def test_running_jobs_are_not_counted(self) -> None:
        from backend.services.ai_cost import summarize_entries

        summary = summarize_entries(
            [
                {
                    "prompt": "in flight",
                    "trace_id": "t3",
                    "status": "running",
                    "model": "gpt-5.6-sol",
                    "provider": "openai",
                    "usage": {"input_tokens": 50_000, "output_tokens": 0},
                    "cost_usd": 0.2,
                }
            ]
        )
        self.assertEqual(summary["cost_usd"], 0.0)
        self.assertEqual(summary["tracked_count"], 0)


if __name__ == "__main__":
    unittest.main()
