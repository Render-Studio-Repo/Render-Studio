"""Deleted projects stay deleted instead of being re-registered or re-seeded."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.database import get_conn, init_db
from backend.services import cad_service, demo_template_service, project_store, teams_service
from backend.services import project_lifecycle as lifecycle


class ProjectLifecycleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.db = self.root / "t.db"
        self.projects = self.root / "projects"
        self.projects.mkdir()
        self.db_patch = patch("backend.database.DB_PATH", self.db)
        self.projects_patch = patch.object(lifecycle, "_projects_root", lambda: self.projects)
        self.db_patch.start()
        self.projects_patch.start()
        init_db()
        with get_conn() as conn:
            conn.execute(
                "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,?)",
                ("owner", "owner@example.com", "Owner", "x", "2026-01-01T00:00:00+00:00"),
            )
            conn.execute(
                "INSERT INTO teams (id, name, created_by, created_at) VALUES (?,?,?,?)",
                ("team1", "Render3D", "owner", "2026-01-01T00:00:00+00:00"),
            )
            conn.execute(
                "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?,?,?,?)",
                ("team1", "owner", "owner", "2026-01-01T00:00:00+00:00"),
            )
            conn.commit()
        self.user = {"id": "owner", "display_name": "Owner", "email": "owner@example.com"}

    def tearDown(self) -> None:
        self.projects_patch.stop()
        self.db_patch.stop()
        self.tmp.cleanup()

    def _write_robot_arm_stub(self, project_id: str) -> Path:
        path = self.projects / project_id
        path.mkdir()
        (path / "arm.urdf").write_text("<robot name='arm'/>", encoding="utf-8")
        project_store.save_meta(
            path,
            {
                "id": project_id,
                "name": "Robot Arm",
                "demo_template": "robot-arm",
                "demo_primary_filename": "Parametric_STEP_Assembly_Of_A_Large_6-axis_Industrial.glb",
            },
        )
        return path

    def test_project_dir_does_not_mkdir_tombstoned_id(self) -> None:
        lifecycle.mark_project_deleted("7f6a0763")
        path = cad_service.project_dir(self.projects, "7f6a0763")
        self.assertEqual(path, self.projects / "7f6a0763")
        self.assertFalse(path.exists())

    def test_migrate_orphan_sweeps_tombstoned_leftover_instead_of_relisting(self) -> None:
        leftover = self._write_robot_arm_stub("7f6a0763")
        lifecycle.mark_project_deleted("7f6a0763")
        n = teams_service.migrate_orphan_projects(self.projects)
        self.assertEqual(n, 0)
        self.assertFalse(leftover.exists())
        with get_conn() as conn:
            row = conn.execute(
                "SELECT 1 FROM project_access WHERE project_id = ?",
                ("7f6a0763",),
            ).fetchone()
        self.assertIsNone(row)

    def test_find_existing_robot_arm_without_glb(self) -> None:
        self._write_robot_arm_stub("7f6a0763")
        teams_service.register_project_access("7f6a0763", "team1", "owner")
        found = demo_template_service.find_existing_template_project(
            self.projects, "owner", "robot-arm"
        )
        self.assertIsNotNone(found)
        self.assertEqual(found["project_id"], "7f6a0763")
        self.assertFalse(found["created"])

    def test_suppressed_demo_does_not_reseed_until_recreate(self) -> None:
        lifecycle.suppress_demo_template("owner", "robot-arm")
        result = demo_template_service.seed_template_project(
            self.projects, self.user, template_id="robot-arm"
        )
        self.assertTrue(result.get("suppressed"))
        self.assertIsNone(result.get("project_id"))
        self.assertFalse(any(self.projects.iterdir()))

        recreated = demo_template_service.seed_template_project(
            self.projects, self.user, template_id="robot-arm", recreate=True
        )
        self.assertTrue(recreated.get("created"))
        self.assertTrue(recreated.get("project_id"))
        self.assertFalse(recreated.get("suppressed"))
        dest = self.projects / recreated["project_id"]
        self.assertTrue(dest.is_dir())
        self.assertTrue(any(dest.glob("*.urdf")) or any(dest.glob("*.srdf")))

    def test_save_meta_does_not_resurrect_deleted_project(self) -> None:
        lifecycle.mark_project_deleted("deadbeef")
        project_store.save_meta(self.projects / "deadbeef", {"id": "deadbeef", "name": "Nope"})
        self.assertFalse((self.projects / "deadbeef").exists())

    def test_mint_project_id_skips_tombstones(self) -> None:
        lifecycle.mark_project_deleted("aaaaaaaa")
        with patch("backend.services.project_lifecycle.uuid.uuid4") as fake_uuid:
            fake_uuid.side_effect = [
                type("U", (), {"__str__": lambda self: "aaaaaaaa-1111-2222-3333-444444444444"})(),
                type("U", (), {"__str__": lambda self: "bbbbbbbb-1111-2222-3333-444444444444"})(),
            ]
            pid = lifecycle.mint_project_id(self.projects)
        self.assertEqual(pid, "bbbbbbbb")


if __name__ == "__main__":
    unittest.main()
