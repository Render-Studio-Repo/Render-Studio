"""Instance setup writes gitignored env without echoing secrets."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import instance_setup_service as setup
from backend.services import log_redact


class InstanceSetupTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.env = Path(self.tmp.name) / ".env"
        self.state = Path(self.tmp.name) / "instance_setup.json"
        self.env.write_text("OPENAI_API_KEY=placeholder-not-a-real-key\n", encoding="utf-8")
        self.p_env = patch.object(setup, "ENV_FILE", self.env)
        self.p_state = patch.object(setup, "SETUP_PATH", self.state)
        self.p_env.start()
        self.p_state.start()

    def tearDown(self) -> None:
        self.p_env.stop()
        self.p_state.stop()
        self.tmp.cleanup()

    def test_local_flag_sets_users_backend(self) -> None:
        with patch.object(setup, "_apply_settings"):
            out = setup.save_local()
        self.assertTrue(out["ok"])
        self.assertEqual(out["users_backend"], "sqlite")
        text = self.env.read_text(encoding="utf-8")
        self.assertIn("USERS_BACKEND=local", text)
        self.assertNotIn("service_role", text.lower())

    def test_bad_url_rejected(self) -> None:
        with self.assertRaises(ValueError):
            setup.save_supabase(url="http://example.com", service_role_key="x")

    def test_redact_filter_strips_bearer(self) -> None:
        cleaned = log_redact.redact_text("Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb")
        self.assertIn("[redacted]", cleaned)
        self.assertNotIn("eyJ", cleaned)

    def test_telemetry_opt_in_persists(self) -> None:
        with patch("backend.services.debug_training_service.ensure_local_instance", return_value={"ok": True}):
            out = setup.set_telemetry_opt_in(True)
        self.assertTrue(out["ok"])
        self.assertTrue(out["telemetry_opt_in"])
        self.assertTrue(setup.telemetry_answered())
        self.assertTrue(setup.telemetry_opt_in())
        setup.set_telemetry_opt_in(False)
        self.assertFalse(setup.telemetry_opt_in())
        self.assertTrue(setup.telemetry_answered())


if __name__ == "__main__":
    unittest.main()
