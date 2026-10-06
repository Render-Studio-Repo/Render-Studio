"""Cloud compute waitlist persists on the user and emails Sam once."""

from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.database import get_conn, init_db
from backend.services import cloud_compute_interest_service as interest
from backend.services.feature_request_service import SAM_EMAIL


class CloudComputeInterestTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "studio.db"
        self.patches = [
            patch("backend.database.DB_PATH", self.db),
            patch("backend.services.cloud_compute_interest_service._ensure_remote_column"),
            patch("backend.services.cloud_compute_interest_service._persist_supabase", return_value={"ok": True}),
        ]
        for item in self.patches:
            item.start()
        init_db()
        with get_conn() as conn:
            conn.execute(
                "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,?)",
                ("u1", "ada@example.com", "Ada", "x", "2026-09-14T00:00:00+00:00"),
            )
            conn.commit()
        interest.ensure_schema()

    def tearDown(self) -> None:
        for item in self.patches:
            item.stop()
        self.tmp.cleanup()

    def test_signup_sets_column_and_emails_sam_once(self):
        user = {"id": "u1", "email": "ada@example.com", "display_name": "Ada"}
        with patch("backend.services.cloud_compute_interest_service._email_sam", return_value={"ok": True, "to": SAM_EMAIL}) as mail:
            first = interest.signup(user)
            second = interest.signup(user)
        self.assertTrue(first["ok"])
        self.assertTrue(first["interested"])
        self.assertFalse(first["already"])
        self.assertTrue(first["notified"])
        self.assertEqual(first["notify_to"], SAM_EMAIL)
        self.assertTrue(second["already"])
        self.assertFalse(second["notified"])
        mail.assert_called_once()
        self.assertTrue(interest.is_interested("u1"))
        with get_conn() as conn:
            row = conn.execute("SELECT cloud_compute_interest FROM users WHERE id = ?", ("u1",)).fetchone()
        self.assertEqual(int(row["cloud_compute_interest"]), 1)
        self.assertEqual(SAM_EMAIL, "sam@render3d.app")

    def test_sqlite_column_exists_after_ensure(self):
        with get_conn() as conn:
            cols = {r[1] for r in conn.execute("PRAGMA table_info(users)").fetchall()}
        self.assertIn("cloud_compute_interest", cols)
        self.assertIn("cloud_compute_interest_at", cols)
        self.assertIsInstance(sqlite3.connect(str(self.db)), sqlite3.Connection)
