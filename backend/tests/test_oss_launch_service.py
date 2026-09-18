from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path

from backend.services.oss_launch_service import get_public_checklist_state


SCHEMA = """
CREATE TABLE knowledge_bases (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE knowledge_folders (
    id TEXT PRIMARY KEY,
    kb_id TEXT NOT NULL,
    parent_id TEXT,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE knowledge_items (
    id TEXT PRIMARY KEY,
    kb_id TEXT NOT NULL,
    folder_id TEXT,
    name TEXT NOT NULL,
    media_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    storage_path TEXT NOT NULL,
    text_excerpt TEXT NOT NULL DEFAULT '',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE knowledge_skill_links (
    kb_id TEXT NOT NULL,
    skill_id TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE knowledge_shares (
    id TEXT PRIMARY KEY,
    kb_id TEXT NOT NULL,
    share_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    shared_by TEXT NOT NULL,
    created_at TEXT NOT NULL
);
"""


def create_test_db(path: Path) -> None:
    with sqlite3.connect(path) as conn:
        conn.executescript(SCHEMA)


class OSSLLaunchServiceTest(unittest.TestCase):
    def test_clean_install_passes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db_path = root / "render3d.db"
            create_test_db(db_path)

            state = get_public_checklist_state(data_dir=root, db_path=db_path)["knowledge_state"]

            self.assertEqual(state["kind"], "clean")
            self.assertEqual(state["status"], "pass")
            self.assertFalse(state["fail_closed"])

    def test_dirty_install_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db_path = root / "render3d.db"
            create_test_db(db_path)
            kb_dir = root / "knowledge" / "user-a" / "kb-1"
            kb_dir.mkdir(parents=True, exist_ok=True)
            stored_file = kb_dir / "item-1__manual.md"
            stored_file.write_text("# Manual\n", encoding="utf-8")

            with sqlite3.connect(db_path) as conn:
                conn.execute(
                    """
                    INSERT INTO knowledge_bases (id, user_id, name, description, created_at, updated_at)
                    VALUES ('kb-1', 'user-a', 'Manuals', '', '2026-09-18T00:00:00+00:00', '2026-09-18T00:00:00+00:00')
                    """
                )
                conn.execute(
                    """
                    INSERT INTO knowledge_items (id, kb_id, folder_id, name, media_type, storage_path, text_excerpt, size_bytes, created_at)
                    VALUES ('item-1', 'kb-1', NULL, 'manual.md', 'text/markdown', 'item-1__manual.md', '# Manual', 9, '2026-09-18T00:00:00+00:00')
                    """
                )

            state = get_public_checklist_state(data_dir=root, db_path=db_path)["knowledge_state"]

            self.assertEqual(state["kind"], "dirty")
            self.assertEqual(state["status"], "fail")
            self.assertTrue(state["fail_closed"])

    def test_half_seeded_install_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db_path = root / "render3d.db"
            create_test_db(db_path)
            (root / "knowledge" / "user-a" / "kb-1").mkdir(parents=True, exist_ok=True)

            with sqlite3.connect(db_path) as conn:
                conn.execute(
                    """
                    INSERT INTO knowledge_bases (id, user_id, name, description, created_at, updated_at)
                    VALUES ('kb-1', 'user-a', 'Manuals', '', '2026-09-18T00:00:00+00:00', '2026-09-18T00:00:00+00:00')
                    """
                )
                conn.execute(
                    """
                    INSERT INTO knowledge_items (id, kb_id, folder_id, name, media_type, storage_path, text_excerpt, size_bytes, created_at)
                    VALUES ('item-1', 'kb-1', NULL, 'manual.md', 'text/markdown', 'item-1__manual.md', '# Manual', 9, '2026-09-18T00:00:00+00:00')
                    """
                )

            state = get_public_checklist_state(data_dir=root, db_path=db_path)["knowledge_state"]

            self.assertEqual(state["kind"], "half_seeded")
            self.assertEqual(state["status"], "fail")
            self.assertTrue(state["fail_closed"])
            self.assertTrue(any("missing on disk" in line for line in state["details"]))


if __name__ == "__main__":
    unittest.main()
