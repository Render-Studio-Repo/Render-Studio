"""Debug-training fingerprints, clustering, and solve retros."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import debug_training_service as svc


STACK_A = """
Traceback (most recent call last):
  File "/Users/sam/Render-Studio/backend/main.py", line 12, in dispatch
    handler()
  File "/Users/sam/Render-Studio/backend/services/viewport_boot.py", line 88, in boot
    raise RuntimeError("canvas missing")
RuntimeError: canvas missing
"""

STACK_B = """
Traceback (most recent call last):
  File "/Users/alex/Render-Studio/backend/main.py", line 99, in dispatch
    handler()
  File "/Users/alex/Render-Studio/backend/services/viewport_boot.py", line 120, in boot
    raise RuntimeError("canvas missing")
RuntimeError: canvas missing
"""

STACK_OTHER = """
Traceback (most recent call last):
  File "/Users/sam/Render-Studio/backend/services/billing.py", line 4, in charge
    raise ValueError("no key")
ValueError: no key
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb
"""


class DebugTrainingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.db = root / "debug_training.sqlite3"
        self.patches = [
            patch.object(svc, "DB_PATH", self.db),
            patch.object(svc, "is_official_hub", return_value=True),
            patch.object(svc, "telemetry_opted_in", return_value=True),
            patch.object(svc, "should_forward_to_hub", return_value=False),
            patch.object(
                svc,
                "local_identity",
                return_value={"instance_id": "11111111-1111-1111-1111-111111111111", "instance_secret": "secret-secret-secret-1"},
            ),
            patch.object(svc, "_maybe_github_note", return_value=None),
            patch.object(svc, "_maybe_supabase_upsert_instance", return_value=None),
        ]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.temp.cleanup()

    def test_same_traceback_different_homes_share_fingerprint(self):
        a, exc, top = svc.traceback_fingerprint(STACK_A)
        b, exc_b, top_b = svc.traceback_fingerprint(STACK_B)
        self.assertEqual(a, b)
        self.assertEqual(exc, "RuntimeError")
        self.assertEqual(top, "viewport_boot.py:boot")
        self.assertEqual(exc_b, exc)
        self.assertEqual(top_b, top)

    def test_redacts_bearer_from_packet(self):
        cleaned = svc.redact_traceback(STACK_OTHER)
        self.assertNotIn("eyJ", cleaned)
        self.assertIn("[redacted]", cleaned)

    def test_similar_count_and_same_scenario(self):
        first = svc.ingest_report(
            title="canvas",
            traceback_text=STACK_A,
            feature_check={"viewport.boot": "broken", "webgl.context": "ok"},
            source="test",
            instance_id="11111111-1111-1111-1111-111111111111",
        )
        self.assertEqual(first["cluster"]["similar_count"], 1)
        self.assertFalse(first["cluster"]["same_scenario"])
        second = svc.ingest_report(
            title="canvas again",
            traceback_text=STACK_B,
            feature_check={"webgl.context": "ok", "viewport.boot": "broken"},
            source="test",
            instance_id="22222222-2222-2222-2222-222222222222",
        )
        self.assertEqual(second["cluster"]["similar_count"], 2)
        self.assertTrue(second["cluster"]["same_scenario"])
        self.assertEqual(second["traceback_id"][:4], "trb_")
        compact = second["cluster"]
        self.assertIn("traceback_id", compact)
        self.assertIn("instance_id", compact)
        self.assertNotIn("traceback_text", compact)

    def test_different_feature_check_is_not_same_scenario(self):
        svc.ingest_report(
            traceback_text=STACK_A,
            feature_check={"viewport.boot": "broken"},
            instance_id="11111111-1111-1111-1111-111111111111",
        )
        other = svc.ingest_report(
            traceback_text=STACK_B,
            feature_check={"viewport.boot": "ok"},
            instance_id="22222222-2222-2222-2222-222222222222",
        )
        self.assertFalse(other["cluster"]["same_scenario"])
        self.assertEqual(other["cluster"]["similar_count"], 1)

    def test_solve_report_counts_prompts_and_hours(self):
        packet = svc.ingest_report(
            traceback_text=STACK_A,
            feature_check={"viewport.boot": "broken"},
        )
        report = svc.record_solve_report(
            {
                "traceback_id": packet["traceback_id"],
                "prompts_used": 3,
                "hours_elapsed": 1.5,
                "verdict": "missed_earlier",
                "root_cause": "viewport_boot.boot assumed a canvas",
                "why": "Looked at WebGL first even though the last frame was boot.",
                "lesson": "Start at the last Render frame.",
                "confirmed": True,
            }
        )
        self.assertEqual(report["prompts_used"], 3)
        self.assertEqual(report["hours_elapsed"], 1.5)
        self.assertEqual(report["verdict"], "missed_earlier")
        self.assertTrue(report["confirmed"])

    def test_instance_secret_mismatch_rejected(self):
        svc.register_instance(
            instance_id="33333333-3333-3333-3333-333333333333",
            instance_secret="aaaaaaaaaaaaaaaa",
            telemetry_opt_in=True,
        )
        with self.assertRaises(ValueError):
            svc.register_instance(
                instance_id="33333333-3333-3333-3333-333333333333",
                instance_secret="bbbbbbbbbbbbbbbb",
            )
        self.assertTrue(
            svc.verify_instance("33333333-3333-3333-3333-333333333333", "aaaaaaaaaaaaaaaa")
        )


if __name__ == "__main__":
    unittest.main()
