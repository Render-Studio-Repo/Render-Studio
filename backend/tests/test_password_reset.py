"""Forgot-password email + token consume."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.auth import hash_password
from backend.database import get_conn, init_db
from backend.services import password_reset_service as reset
from backend.services import teams_service


class PasswordResetTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "t.db"
        self.db_patch = patch("backend.database.DB_PATH", self.db)
        self.db_patch.start()
        init_db()
        with get_conn() as conn:
            conn.execute(
                "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,?)",
                ("u1", "sam@example.com", "Sam", hash_password("old-pass"), "2026-01-01T00:00:00+00:00"),
            )
            conn.commit()
        self.mail = patch.object(
            reset.email_notification_service,
            "send_email",
            return_value={"ok": True},
        )
        self.mail_mock = self.mail.start()
        self.sb = patch("backend.services.supabase_auth_service.enabled", return_value=False)
        self.sb.start()
        self.sbu = patch("backend.services.supabase_users_store.enabled", return_value=False)
        self.sbu.start()

    def tearDown(self) -> None:
        self.mail.stop()
        self.sb.stop()
        self.sbu.stop()
        self.db_patch.stop()
        self.tmp.cleanup()

    def test_unknown_email_is_generic_and_sends_nothing(self) -> None:
        out = reset.request_reset("nobody@example.com", origin="https://render3d.app")
        self.assertTrue(out["ok"])
        self.mail_mock.assert_not_called()

    def test_known_email_sends_link_and_token_resets_password(self) -> None:
        out = reset.request_reset("sam@example.com", origin="https://render3d.app")
        self.assertTrue(out["ok"])
        self.mail_mock.assert_called_once()
        kwargs = self.mail_mock.call_args.kwargs
        self.assertIn("reset-password?token=", kwargs["text"])
        token = kwargs["text"].split("reset-password?token=")[1].split()[0]
        result = reset.reset_password(token, "new-pass1")
        self.assertTrue(result["ok"])
        self.assertEqual(result["user"]["email"], "sam@example.com")
        self.assertTrue(teams_service.authenticate("sam@example.com", "new-pass1"))
        self.assertIsNone(teams_service.authenticate("sam@example.com", "old-pass"))

    def test_token_cannot_be_reused(self) -> None:
        token = reset.create_reset_token("u1", "sam@example.com")
        reset.reset_password(token, "second-pass")
        with self.assertRaises(ValueError):
            reset.reset_password(token, "third-pass")


if __name__ == "__main__":
    unittest.main()
