"""Ops logs, roles, ownership transfer, and workspace watchdogs."""

from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from backend.database import get_conn, init_db
from backend.services import ops_log_service, platform_roles_service, teams_service, workspace_automation_service, workspace_log_service


class OpsWorkspaceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.db = self.root / "t.db"
        self.ops = self.root / "ops"
        self.db_patch = patch("backend.database.DB_PATH", self.db)
        self.ops_patch = patch("backend.services.ops_log_service.OPS_ROOT", self.ops)
        self.sb_patch = patch("backend.services.platform_roles_service._prefer_supabase_roles", return_value=False)
        self.db_patch.start()
        self.ops_patch.start()
        self.sb_patch.start()
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
            conn.execute(
                "INSERT INTO teams (id, name, created_by, created_at) VALUES (?,?,?,?)",
                ("ws1", "Studio", "sam", now),
            )
            conn.execute(
                "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?,?,?,?)",
                ("ws1", "sam", "owner", now),
            )
            conn.execute(
                "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?,?,?,?)",
                ("ws1", "bob", "user", now),
            )
            conn.commit()

    def tearDown(self) -> None:
        self.ops_patch.stop()
        self.sb_patch.stop()
        self.db_patch.stop()
        self.tmp.cleanup()

    def test_miniaturize_and_prune_temp(self) -> None:
        long = "line\n" * 40
        note = ops_log_service.write_note("activity_logs", "tick", long)
        self.assertTrue(note["ok"])
        text = (self.ops / "Activity-monitor" / "logs" / Path(note["path"]).name).read_text(encoding="utf-8")
        self.assertLessEqual(len(text.encode("utf-8")), ops_log_service.MAX_NOTE_BYTES + 8)
        self.assertLessEqual(text.count("\n"), 12)
        for i in range(25):
            ops_log_service.write_note("activity_logs", f"tick-{i}", "ok")
        leftover = list((self.ops / "Activity-monitor" / "logs").glob("*.md"))
        self.assertLessEqual(len(leftover), 20)

    def test_critical_notes_still_hit_folder_cap(self) -> None:
        for i in range(40):
            ops_log_service.write_note("activity", f"crit-{i}", "spike", keep=True)
        leftover = [
            p for p in (self.ops / "Activity-monitor").glob("*.md") if p.name.lower() != "readme.md"
        ]
        self.assertLessEqual(len(leftover), ops_log_service.KEEP_MAX["activity"])

    def test_bugs_folder_has_safety_cap(self) -> None:
        for i in range(90):
            ops_log_service.write_note("bugs", f"bug-{i}", "crash", keep=True)
        leftover = [p for p in (self.ops / "Possible-bugs").glob("*.md") if p.name.lower() != "readme.md"]
        self.assertLessEqual(len(leftover), ops_log_service.KEEP_MAX["bugs"])

    def test_workspace_activity_prunes_to_cap(self) -> None:
        old = workspace_log_service.MAX_ENTRIES
        workspace_log_service.MAX_ENTRIES = 8
        try:
            for i in range(20):
                workspace_log_service.append_event("ws1", kind="folder", label=f"e-{i}", user_id="sam")
            with get_conn() as conn:
                n = conn.execute(
                    "SELECT COUNT(*) AS n FROM workspace_activity WHERE team_id=?",
                    ("ws1",),
                ).fetchone()["n"]
            self.assertLessEqual(int(n), 8)
        finally:
            workspace_log_service.MAX_ENTRIES = old

    def test_schedule_parse(self) -> None:
        hourly = workspace_automation_service.parse_schedule("watch hourly", None, None)
        self.assertEqual(hourly["kind"], "hourly")
        self.assertEqual(hourly["interval_minutes"], 60)
        days = workspace_automation_service.parse_schedule("next 2 days", None, None)
        self.assertEqual(days["kind"], "next_2_days")
        self.assertTrue(days["expires_at"])
        custom = workspace_automation_service.parse_schedule("every 6 hours", "custom", None)
        self.assertEqual(custom["interval_minutes"], 360)

    def test_create_watchdog_owned_only(self) -> None:
        user = {"id": "sam", "email": "a1projects@protonmail.com", "display_name": "Sam"}
        auto = workspace_automation_service.create_automation(
            user,
            prompt="Compare project expenses and email me if a bug starts failing.",
            team_ids=["ws1"],
            schedule_kind="hourly",
            email_if=True,
            email_chips=["bug"],
            email_scenario="generation errors",
        )
        self.assertEqual(auto["team_ids"], ["ws1"])
        self.assertTrue(auto["email_if"])
        bob = {"id": "bob", "email": "bob@example.com", "display_name": "Bob"}
        with self.assertRaises(ValueError):
            workspace_automation_service.create_automation(bob, prompt="watch this", team_ids=["ws1"])

    def test_transfer_and_manager(self) -> None:
        teams_service.set_member_role("ws1", "bob", "manager", "sam")
        member = teams_service.set_member_permissions(
            "ws1", "bob", "sam", can_export=False, can_access_tools=False, access="view"
        )
        self.assertEqual(member["role"], "manager")
        self.assertFalse(member["can_export"])
        owner = teams_service.transfer_ownership("ws1", "bob", "sam")
        self.assertEqual(owner["role"], "owner")
        self.assertTrue(owner["can_export"])

    def test_super_admin_appoints_manager(self) -> None:
        sam = {"id": "sam", "email": "a1projects@protonmail.com"}
        row = platform_roles_service.set_role(
            sam, "bob", role="manager", can_export=True, can_edit_files=True, can_access_tools=False, workspace_ids=["ws1"]
        )
        self.assertEqual(row["role"], "manager")
        self.assertTrue(row["can_export"])
        self.assertFalse(row["can_access_tools"])
        bob = {"id": "bob", "email": "bob@example.com"}
        with self.assertRaises(PermissionError):
            platform_roles_service.set_role(bob, "sam", role="manager")

    def test_users_control_directory_and_group_permissions(self) -> None:
        sam = {"id": "sam", "email": "a1projects@protonmail.com"}
        perm_path = self.root / "platform_group_permissions.json"
        with patch.object(platform_roles_service, "_group_perm_path", return_value=perm_path):
            platform_roles_service.set_role(sam, "bob", role="manager", can_export=True)
            directory = platform_roles_service.control_directory()
            self.assertIn("manager", directory["groups"])
            self.assertIn("user", directory["groups"])
            self.assertIn("admin", directory["groups"])
            self.assertIn("workspace", directory["groups"])
            self.assertGreaterEqual(directory["groups"]["admin"]["count"], 1)
            self.assertEqual(directory["groups"]["manager"]["count"], 1)
            self.assertTrue(any(m["user_id"] == "sam" for m in directory["groups"]["admin"]["members"]))
            self.assertTrue(any(m["user_id"] == "sam" for m in directory["groups"]["workspace"]["members"]))
            self.assertTrue(directory["stats"]["by_role"])
            self.assertTrue(directory["stats"]["permission_coverage"])
            saved = platform_roles_service.set_group_permissions(
                sam, "manager", {"can_export": False, "can_access_tools": True}, apply_to_members=True
            )
            self.assertFalse(saved["permissions"]["can_export"])
            self.assertTrue(perm_path.is_file())
            role = platform_roles_service.get_role({"id": "bob", "email": "bob@example.com"})
            self.assertFalse(role["can_export"])
            member = platform_roles_service.set_workspace_member_permissions(
                sam, "ws1", "bob", can_export=False, can_edit_files=False
            )
            self.assertFalse(member["can_export"])
            self.assertEqual(member["access"], "view")
            with self.assertRaises(ValueError):
                platform_roles_service.set_workspace_member_permissions(sam, "ws1", "sam", can_export=False)
            bob = {"id": "bob", "email": "bob@example.com"}
            with self.assertRaises(PermissionError):
                platform_roles_service.set_group_permissions(bob, "user", {"can_export": True})

    def test_watchdog_events_are_one_line(self):
        user = {"id": "sam", "email": "a1projects@protonmail.com", "display_name": "Sam"}
        auto = workspace_automation_service.create_automation(
            user,
            prompt="Watch spend and errors",
            team_ids=["ws1"],
            schedule_kind="custom",
            interval_minutes=5,
        )
        workspace_automation_service.run_one(auto["id"], "sam")
        listed = workspace_automation_service.list_automations("sam")[0]
        self.assertNotIn("\n", listed["last_preview"])
        self.assertTrue(listed["events"])
        for ev in listed["events"]:
            self.assertNotIn("\n", ev["text"])
            self.assertLessEqual(len(ev["text"]), 120)


if __name__ == "__main__":
    unittest.main()
