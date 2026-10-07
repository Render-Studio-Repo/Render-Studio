"""GET /api/projects must not open SQLite once per project for incognito flags."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.database import get_conn, init_db
from backend.services import project_incognito_service


class IncognitoListBatchTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "t.db"
        self.db_patch = patch("backend.database.DB_PATH", self.db)
        self.db_patch.start()
        project_incognito_service._TABLES_READY_FOR = None
        init_db()

    def tearDown(self) -> None:
        self.db_patch.stop()
        self.tmp.cleanup()

    def test_list_index_skips_per_row_sql_when_empty(self) -> None:
        index = project_incognito_service.list_index("sam")
        self.assertEqual(index, {})
        with patch("backend.services.project_incognito_service.get_conn") as mocked:
            for i in range(200):
                hidden = project_incognito_service.should_hide_from_user(
                    f"p{i}", "sam", owner_user_id="sam", index=index
                )
                row = project_incognito_service.annotate_project({"id": f"p{i}"}, "sam", index=index)
                self.assertFalse(hidden)
                self.assertFalse(row["incognito"])
            mocked.assert_not_called()

    def test_list_index_hides_other_users_incognito(self) -> None:
        project_incognito_service.ensure_tables()
        now = "2026-09-08T00:00:00+00:00"
        with get_conn() as conn:
            conn.execute(
                "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,?)",
                ("sam", "sam@example.com", "Sam", "x", now),
            )
            conn.execute(
                "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,?)",
                ("bob", "bob@example.com", "Bob", "x", now),
            )
            conn.execute(
                """
                INSERT INTO project_incognito
                    (project_id, owner_user_id, enabled, pin_salt, pin_hash, created_at, updated_at)
                VALUES (?,?,?,?,?,?,?)
                """,
                ("secret", "bob", 1, None, None, now, now),
            )
            conn.commit()
        index = project_incognito_service.list_index("sam")
        self.assertTrue(
            project_incognito_service.should_hide_from_user(
                "secret", "sam", owner_user_id="bob", index=index
            )
        )
        self.assertFalse(
            project_incognito_service.should_hide_from_user(
                "mine", "sam", owner_user_id="sam", index=index
            )
        )


if __name__ == "__main__":
    unittest.main()
