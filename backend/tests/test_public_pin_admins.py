"""Guest public folder, admin pin-to-public, and site admin grant/revoke."""

from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from backend.database import get_conn, init_db
from backend.services import platform_roles_service


class SiteAdminPermissionsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "t.db"
        self.db_patch = patch("backend.database.DB_PATH", self.db)
        self.db_patch.start()
        init_db()
        now = datetime.now(timezone.utc).isoformat()
        with get_conn() as conn:
            conn.execute(
                "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,?)",
                ("sam", "a1projects@protonmail.com", "Sam", "x", now),
            )
            conn.execute(
                "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,?)",
                ("bob", "bob@example.com", "Bob", "x", now),
            )
            conn.commit()
        self.sam = {"id": "sam", "email": "a1projects@protonmail.com"}
        self.bob = {"id": "bob", "email": "bob@example.com"}

    def tearDown(self) -> None:
        self.db_patch.stop()
        self.tmp.cleanup()

    def test_super_admin_can_grant_and_revoke_site_admin(self) -> None:
        with patch.object(platform_roles_service, "_prefer_supabase_roles", return_value=False):
            platform_roles_service.set_site_admin(self.sam, email="bob@example.com", admin=True)
            self.assertTrue(platform_roles_service.is_platform_admin(self.bob))
            emails = {row["email"] for row in platform_roles_service.list_site_admins()}
            self.assertIn("bob@example.com", emails)
            platform_roles_service.set_site_admin(self.sam, email="bob@example.com", admin=False)
            self.assertEqual(platform_roles_service.stored_role_name(self.bob), "user")
            self.assertFalse(platform_roles_service.is_platform_admin(self.bob))

    def test_revoked_user_cannot_grant_admin(self) -> None:
        with patch.object(platform_roles_service, "_prefer_supabase_roles", return_value=False):
            with self.assertRaises(PermissionError):
                platform_roles_service.set_site_admin(self.bob, email="bob@example.com", admin=True)

    def test_cannot_revoke_super_admin(self) -> None:
        with patch.object(platform_roles_service, "_prefer_supabase_roles", return_value=False):
            with self.assertRaises(ValueError):
                platform_roles_service.set_site_admin(self.sam, email="a1projects@protonmail.com", admin=False)


class GuestPublicListTests(unittest.TestCase):
    def test_list_projects_allows_optional_auth(self) -> None:
        src = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")
        start = src.index("def list_projects(")
        fn = src[start:src.index("@app.get(\"/api/public/projects\")")]
        self.assertIn("get_current_user_optional", fn)
        self.assertIn("if not user:", fn)
        self.assertIn("_public_project_summaries()", fn)

    def test_remix_still_requires_login(self) -> None:
        src = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")
        start = src.index("def remix_public_project(")
        fn = src[start:start + 600]
        self.assertIn("get_current_user", fn)
        self.assertNotIn("get_current_user_optional", fn)

    def test_public_pin_endpoint_is_admin_only(self) -> None:
        src = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")
        start = src.index("def set_project_public_pin(")
        fn = src[start:src.index("@app.get(\"/api/projects/{project_id}/incognito\")")]
        self.assertIn("_require_a1projects_admin", fn)
        self.assertIn("public_pinned", fn)
        self.assertIn("ORDER BY pa.public_pinned DESC", src)


if __name__ == "__main__":
    unittest.main()
