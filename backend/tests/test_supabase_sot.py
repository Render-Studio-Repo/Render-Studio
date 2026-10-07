"""Supabase is source of truth: sqlite password must not succeed when remote is configured."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.auth import hash_password
from backend.database import get_conn, init_db
from backend.services import teams_service


class SupabaseSourceOfTruthTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "t.db"
        self.db_patch = patch("backend.database.DB_PATH", self.db)
        self.db_patch.start()
        init_db()
        with get_conn() as conn:
            conn.execute(
                "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,?)",
                ("u1", "sam@example.com", "Sam", hash_password("local-pass"), "2026-01-01T00:00:00+00:00"),
            )
            conn.commit()

    def tearDown(self) -> None:
        self.db_patch.stop()
        self.tmp.cleanup()

    def test_configured_supabase_does_not_fall_back_to_sqlite_password(self) -> None:
        with (
            patch("backend.services.supabase_users_store.prefer_supabase", return_value=True),
            patch("backend.services.supabase_users_store.source_of_truth", return_value=True),
            patch("backend.services.supabase_users_store.get_by_email", return_value={"id": "u1", "email": "sam@example.com", "display_name": "Sam"}),
            patch("backend.services.supabase_users_store.verify_password_for_email", return_value=False),
            patch("backend.services.supabase_auth_service.enabled", return_value=False),
        ):
            self.assertIsNone(teams_service.authenticate("sam@example.com", "local-pass"))

    def test_supabase_password_wins_even_if_sqlite_hash_differs(self) -> None:
        with (
            patch("backend.services.supabase_users_store.prefer_supabase", return_value=True),
            patch("backend.services.supabase_users_store.source_of_truth", return_value=True),
            patch(
                "backend.services.supabase_users_store.get_by_email",
                return_value={"id": "u1", "email": "sam@example.com", "display_name": "Sam", "username": "sam"},
            ),
            patch("backend.services.supabase_users_store.verify_password_for_email", return_value=True),
            patch("backend.services.supabase_users_store.touch_last_login", return_value=None),
            patch("backend.services.supabase_auth_service.enabled", return_value=False),
        ):
            user = teams_service.authenticate("sam@example.com", "remote-pass")
            self.assertIsNotNone(user)
            self.assertEqual(user["id"], "u1")

    def test_unreachable_supabase_fails_closed(self) -> None:
        with (
            patch("backend.services.supabase_users_store.prefer_supabase", return_value=True),
            patch("backend.services.supabase_users_store.source_of_truth", return_value=False),
            patch("backend.services.supabase_users_store.get_by_email", return_value=None),
            patch("backend.services.supabase_auth_service.enabled", return_value=True),
            patch(
                "backend.services.supabase_auth_service.sign_in",
                return_value={"ok": False, "error": "unreachable", "user": None},
            ),
        ):
            with self.assertRaises(teams_service.AccountServiceUnavailable):
                teams_service.authenticate("sam@example.com", "local-pass")

    def test_gotrue_is_called_even_when_users_table_is_down(self) -> None:
        """Login form must hit Supabase Auth; Users probe must not gate it."""
        with (
            patch("backend.services.supabase_users_store.prefer_supabase", return_value=True),
            patch("backend.services.supabase_users_store.source_of_truth", return_value=False),
            patch("backend.services.supabase_users_store.get_by_email", return_value=None),
            patch("backend.services.supabase_users_store.touch_last_login", return_value=None),
            patch("backend.services.supabase_auth_service.enabled", return_value=True),
            patch(
                "backend.services.supabase_auth_service.sign_in",
                return_value={
                    "ok": True,
                    "error": "",
                    "user": {"email": "sam@example.com", "user_metadata": {"app_user_id": "u1"}},
                },
            ) as sign_in,
        ):
            user = teams_service.authenticate("sam@example.com", "remote-pass")
            self.assertIsNotNone(user)
            self.assertEqual(user["id"], "u1")
            sign_in.assert_called_once_with("sam@example.com", "remote-pass")

    def test_invalid_gotrue_password_does_not_use_sqlite(self) -> None:
        with (
            patch("backend.services.supabase_users_store.prefer_supabase", return_value=True),
            patch("backend.services.supabase_users_store.source_of_truth", return_value=True),
            patch("backend.services.supabase_users_store.get_by_email", return_value=None),
            patch("backend.services.supabase_auth_service.enabled", return_value=True),
            patch(
                "backend.services.supabase_auth_service.sign_in",
                return_value={"ok": False, "error": "invalid", "user": None},
            ),
        ):
            self.assertIsNone(teams_service.authenticate("sam@example.com", "local-pass"))

    def test_not_configured_gotrue_is_unavailable_not_denied(self) -> None:
        with (
            patch("backend.services.supabase_users_store.prefer_supabase", return_value=True),
            patch("backend.services.supabase_users_store.source_of_truth", return_value=False),
            patch("backend.services.supabase_users_store.get_by_email", return_value=None),
            patch("backend.services.supabase_auth_service.enabled", return_value=True),
            patch(
                "backend.services.supabase_auth_service.sign_in",
                return_value={"ok": False, "error": "not_configured", "user": None},
            ),
        ):
            with self.assertRaises(teams_service.AccountServiceUnavailable) as ctx:
                teams_service.authenticate("sam@example.com", "local-pass")
            self.assertIn("SUPABASE", str(ctx.exception).upper())

    def test_local_mode_still_uses_sqlite(self) -> None:
        with (
            patch("backend.services.supabase_users_store.prefer_supabase", return_value=False),
        ):
            self.assertTrue(teams_service.authenticate("sam@example.com", "local-pass"))


if __name__ == "__main__":
    unittest.main()
