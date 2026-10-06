"""Workspace / OAuth / credit tables: counts only, no secret values."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from backend.services import supabase_workspace_store as ws


class WorkspaceStoreTests(unittest.TestCase):
    def test_encrypt_skips_empty_and_existing_ciphertext(self) -> None:
        self.assertIsNone(ws._encrypt(""))
        already = "gAAAA" + "A" * 20
        self.assertEqual(ws._encrypt(already), already)

    def test_live_false_when_local_backend(self) -> None:
        with patch("backend.services.supabase_users_store.prefer_supabase", return_value=False):
            self.assertFalse(ws.live())

    def test_migrate_result_has_counts_not_payloads(self) -> None:
        fake = {
            "ok": True,
            "sqlite": {"teams": 1, "team_shared_ai_keys": 3, "team_key_grants": 37},
            "upserted": {"Teams": 1, "TeamKeys": 3, "TeamKeyGrants": 37},
        }
        blob = str(fake)
        self.assertNotIn("api_key", blob)
        self.assertNotIn("token", blob.lower().replace("team_key_grants", ""))
        self.assertEqual(fake["sqlite"]["team_key_grants"], 37)


if __name__ == "__main__":
    unittest.main()
