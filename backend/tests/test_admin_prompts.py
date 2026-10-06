from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from backend.services.admin_prompt_payload import (
    entry_token_counts,
    prompt_preview_url,
    serialize_admin_prompt_entry,
    snapshot_index,
)


class AdminPromptPayloadTests(unittest.TestCase):
    def test_token_counts_from_usage_aliases(self):
        counts = entry_token_counts(
            {"usage": {"prompt_tokens": 11, "completion_tokens": 4}}
        )
        self.assertEqual(counts["input_tokens"], 11)
        self.assertEqual(counts["output_tokens"], 4)
        self.assertEqual(counts["total_tokens"], 15)

    def test_snapshot_index_and_preview_url(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            (project / "bracket_snapshot_iso_1.png").write_bytes(b"png")
            mapping = snapshot_index(project)
            self.assertEqual(mapping.get("bracket"), "bracket_snapshot_iso_1.png")
            url = prompt_preview_url(
                project_id="proj-1",
                entry={"filename": "bracket.glb"},
                snapshot_map=mapping,
                fallback_preview_url="/fallback.png",
            )
            self.assertIn("bracket_snapshot_iso_1.png", url)
            self.assertTrue(url.startswith("/api/projects/proj-1/files/"))

    def test_serialize_original_vs_rewritten(self):
        row = serialize_admin_prompt_entry(
            {
                "id": "log-9",
                "prompt": "a precise 40mm flange with 4 holes",
                "original_prompt": "make a flange",
                "prompt_improved": True,
                "success": True,
                "user_id": "u1",
                "user_name": "Ada",
                "filename": "flange.glb",
                "usage": {"input_tokens": 100, "output_tokens": 20, "total_tokens": 120},
                "cost_usd": 0.0123,
            },
            project_id="p1",
            project_name="Flange",
            snapshot_map={},
            fallback_preview_url="/api/projects/p1/files/preview.png",
            owner_name="Owner",
            avatar_url_for_user_id=lambda uid: f"/api/users/{uid}/avatar",
        )
        self.assertEqual(row["id"], "log-9")
        self.assertEqual(row["original_prompt"], "make a flange")
        self.assertTrue(row["prompt_improved"])
        self.assertEqual(row["preview_url"], "/api/projects/p1/files/preview.png")
        self.assertEqual(row["input_tokens"], 100)
        self.assertEqual(row["user_avatar_url"], "/api/users/u1/avatar")
        self.assertEqual(row["user_name"], "Ada")

    def test_no_rewrite_when_original_missing(self):
        row = serialize_admin_prompt_entry(
            {"id": "a", "prompt": "only text"},
            project_id="p",
        )
        self.assertIsNone(row["original_prompt"])
        self.assertFalse(row["prompt_improved"])


if __name__ == "__main__":
    unittest.main()
