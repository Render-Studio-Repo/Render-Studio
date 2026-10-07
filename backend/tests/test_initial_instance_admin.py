from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from backend.database import init_db
from backend.services import platform_roles_service as roles


class InitialInstanceAdminTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "render3d.db"
        self.db_patch = patch("backend.database.DB_PATH", self.db)
        self.db_patch.start()
        init_db()

    def tearDown(self) -> None:
        self.db_patch.stop()
        self.tmp.cleanup()

    def _user(self, user_id: str, email: str, created_at: str) -> dict[str, str]:
        from backend.database import get_conn

        with get_conn() as conn:
            conn.execute(
                "INSERT INTO users (id,email,display_name,password_hash,created_at) VALUES (?,?,?,?,?)",
                (user_id, email, user_id, "x", created_at),
            )
            conn.commit()
        return {"id": user_id, "email": email}

    def test_first_account_becomes_local_platform_admin(self) -> None:
        first = self._user("first", "first@example.com", datetime.now(timezone.utc).isoformat())
        with (
            patch.object(roles, "SUPER_ADMIN_EMAILS", set()),
            patch.object(roles, "SITE_ADMIN_EMAILS", set()),
            patch.object(roles, "MANAGEMENT_EMAIL", ""),
            patch.object(roles, "_sync_role_to_supabase"),
        ):
            self.assertTrue(roles.claim_initial_instance_admin(first))
            self.assertTrue(roles.is_platform_admin(first))

    def test_later_account_cannot_claim_initial_admin(self) -> None:
        self._user("first", "first@example.com", "2026-01-01T00:00:00+00:00")
        later = self._user("later", "later@example.com", "2026-01-02T00:00:00+00:00")
        with (
            patch.object(roles, "SUPER_ADMIN_EMAILS", set()),
            patch.object(roles, "SITE_ADMIN_EMAILS", set()),
            patch.object(roles, "MANAGEMENT_EMAIL", ""),
        ):
            self.assertFalse(roles.claim_initial_instance_admin(later))


if __name__ == "__main__":
    unittest.main()
