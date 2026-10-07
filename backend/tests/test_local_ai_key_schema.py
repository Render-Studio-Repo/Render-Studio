import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import database
from backend.services import teams_service, user_ai_keys_service


class LocalAIKeySchemaTests(unittest.TestCase):
    def test_fresh_local_database_has_ai_key_storage(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "render3d.db"
            with patch.object(database, "DB_PATH", path):
                database.init_db()
            with sqlite3.connect(path) as conn:
                tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                user_columns = {row[1] for row in conn.execute("PRAGMA table_info(users)")}
                key_columns = {row[1] for row in conn.execute("PRAGMA table_info(user_ai_keys)")}
            self.assertIn("user_ai_keys", tables)
            self.assertIn("active_ai_key_id", user_columns)
            self.assertTrue({"user_id", "api_key_enc", "provider", "model", "base_url"} <= key_columns)

    def test_fresh_local_account_can_save_an_ai_key(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "render3d.db"
            with patch.object(database, "DB_PATH", path):
                database.init_db()
                user = teams_service.create_user("owner@example.com", "password1", "Owner")
                result = user_ai_keys_service.add_key(
                    user["id"],
                    "openai",
                    "sk-" + "x" * 40,
                    model="gpt-5.5",
                    name="Local test key",
                )
            self.assertEqual(len(result["keys"]), 1)
            self.assertEqual(result["keys"][0]["provider"], "openai")


if __name__ == "__main__":
    unittest.main()
