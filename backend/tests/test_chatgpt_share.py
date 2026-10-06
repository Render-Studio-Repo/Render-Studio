"""ChatGPT trial renders (3) and team-shared ChatGPT logins."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from backend.database import get_conn, init_db
from backend.services import chatgpt_share_service as share


class ChatgptShareTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "t.db"
        self.db_patch = patch("backend.database.DB_PATH", self.db)
        self.db_patch.start()
        init_db()
        self.signed_in: set[str] = set()
        self.auth_patch = patch(
            "backend.services.chatgpt_codex_auth.read_chatgpt_auth",
            side_effect=lambda uid: {"signed_in": str(uid) in self.signed_in},
        )
        self.auth_patch.start()
        with get_conn() as conn:
            conn.execute(
                "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,?)",
                ("host", "a1projects@protonmail.com", "Sam W", "x", "2026-01-01T00:00:00+00:00"),
            )
            conn.execute(
                "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,?)",
                ("newbie", "new@example.com", "New User", "x", "2026-01-01T00:00:00+00:00"),
            )
            conn.execute(
                "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,?)",
                ("mate", "mate@example.com", "Teammate", "x", "2026-01-01T00:00:00+00:00"),
            )
            conn.execute(
                "INSERT INTO teams (id, name, created_by, created_at) VALUES (?,?,?,?)",
                ("team1", "Studio", "host", "2026-01-01T00:00:00+00:00"),
            )
            conn.execute(
                "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?,?,?,?)",
                ("team1", "host", "owner", "2026-01-01T00:00:00+00:00"),
            )
            conn.execute(
                "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?,?,?,?)",
                ("team1", "mate", "member", "2026-01-01T00:00:00+00:00"),
            )
            conn.commit()
        self.signed_in.add("host")

    def tearDown(self) -> None:
        self.auth_patch.stop()
        self.db_patch.stop()
        self.tmp.cleanup()

    def test_grant_and_consume_three_renders(self) -> None:
        self.assertTrue(share.grant_trial_renders("newbie", "1.2.3.4"))
        self.assertFalse(share.grant_trial_renders("newbie", "1.2.3.4"))
        self.assertEqual(share.trial_remaining("newbie"), 3)
        self.assertTrue(share.consume_trial_render("newbie"))
        self.assertTrue(share.consume_trial_render("newbie"))
        self.assertTrue(share.consume_trial_render("newbie"))
        self.assertFalse(share.consume_trial_render("newbie"))
        self.assertEqual(share.trial_remaining("newbie"), 0)
        status = share.trial_status("newbie")
        self.assertEqual(status["kind"], "chatgpt_renders")
        self.assertEqual(status["renders_used"], 3)
        self.assertFalse(status["on_free_trial"])

    def test_trial_resolves_to_host_until_exhausted(self) -> None:
        share.grant_trial_renders("newbie")
        resolved = share.resolve_codex_owner("newbie")
        self.assertEqual(resolved["owner_user_id"], "host")
        self.assertEqual(resolved["kind"], "trial")
        for _ in range(3):
            share.consume_trial_render("newbie")
        resolved = share.resolve_codex_owner("newbie")
        self.assertIsNone(resolved["owner_user_id"])

    def test_own_login_beats_trial(self) -> None:
        share.grant_trial_renders("newbie")
        self.signed_in.add("newbie")
        resolved = share.resolve_codex_owner("newbie")
        self.assertEqual(resolved["kind"], "self")
        self.assertEqual(resolved["owner_user_id"], "newbie")

    def test_design_chat_can_fall_back_when_selected_chatgpt_is_temporarily_unavailable(self) -> None:
        from backend import main

        guest = object()
        with patch.object(main, "_chatgpt_codex_available", return_value=False), patch.object(
            main,
            "_get_ai_for_user",
            side_effect=HTTPException(403, "Trial ChatGPT is unavailable"),
        ), patch.object(main, "_render_agent_guest_ai", return_value=guest) as fallback:
            resolved = main._render_agent_ai(
                {"id": "newbie"},
                key_source="chatgpt",
                requested_model="gpt-6-astra",
                allow_guest_fallback=True,
            )

        self.assertIs(resolved, guest)
        fallback.assert_called_once_with("gpt-6-astra")
        self.assertTrue(main._render_agent_retryable_subscription_error(
            HTTPException(403, "Trial ChatGPT isn’t available right now. Try again in a moment.")
        ))
        self.assertFalse(main._render_agent_retryable_subscription_error(
            HTTPException(402, "Daily ChatGPT spend limit reached")
        ))

    def test_team_share_default_deny(self) -> None:
        share.share_with_team("team1", "host")
        resolved = share.resolve_codex_owner("mate")
        self.assertIsNone(resolved["owner_user_id"])
        members = share.list_share_members("team1", share.list_team_shares("team1", "host")[0]["id"], "host")
        mate = next(m for m in members if m["user_id"] == "mate")
        self.assertFalse(mate["granted"])
        share.set_member_access(
            "team1",
            mate and share.list_team_shares("team1", "host")[0]["id"],
            "mate",
            granted=True,
            requester_id="host",
        )
        resolved = share.resolve_codex_owner("mate")
        self.assertEqual(resolved["kind"], "team")
        self.assertEqual(resolved["owner_user_id"], "host")

    def test_received_team_share_tracks_revocation_and_owner_signout(self) -> None:
        granted = share.share_with_team("team1", "host")
        share.set_member_access("team1", granted["id"], "mate", requester_id="host", granted=True)
        received = share.listing_for_user("mate")["received"]
        self.assertEqual(len(received), 1)
        self.assertEqual(received[0]["owner_user_id"], "host")
        self.assertTrue(received[0]["granted"])
        self.assertTrue(received[0]["owner_signed_in"])
        self.assertFalse(share.listing_for_user("mate")["signed_in"])
        self.assertEqual(share.resolve_codex_owner("mate")["owner_user_id"], "host")
        self.signed_in.discard("host")
        self.assertFalse(share.listing_for_user("mate")["received"][0]["owner_signed_in"])
        self.assertIsNone(share.resolve_codex_owner("mate")["owner_user_id"])
        self.signed_in.add("host")
        share.set_member_access("team1", granted["id"], "mate", requester_id="host", granted=False)
        self.assertEqual(share.listing_for_user("mate")["received"], [])
        self.assertIsNone(share.resolve_codex_owner("mate")["owner_user_id"])

    def test_add_member_with_chatgpt_grant(self) -> None:
        from backend.services import teams_service

        with get_conn() as conn:
            conn.execute(
                "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,?)",
                ("invitee", "invitee@example.com", "Invitee", "x", "2026-01-01T00:00:00+00:00"),
            )
            conn.commit()
        share.share_with_team("team1", "host")
        result = teams_service.add_registered_user_to_team(
            "team1",
            "invitee@example.com",
            "host",
            grant_chatgpt=True,
            confirm_new_collaborator=True,
        )
        self.assertEqual(result["status"], "added")
        self.assertTrue(result.get("chatgpt_granted"))
        resolved = share.resolve_codex_owner("invitee")
        self.assertEqual(resolved["kind"], "team")
        self.assertEqual(resolved["owner_user_id"], "host")

    def test_pending_invite_grants_chatgpt_on_accept(self) -> None:
        from backend.services import teams_service

        share.share_with_team("team1", "host")
        invited = teams_service.invite_user_to_team(
            "team1",
            "newfriend@example.com",
            "host",
            grant_chatgpt=True,
        )
        self.assertEqual(invited["status"], "invited")
        with get_conn() as conn:
            conn.execute(
                "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,?)",
                ("friend", "newfriend@example.com", "Friend", "x", "2026-01-01T00:00:00+00:00"),
            )
            conn.commit()
        accepted = teams_service.accept_team_invite(invited["invite_id"], "friend", "newfriend@example.com")
        self.assertTrue(accepted.get("chatgpt_granted"))
        resolved = share.resolve_codex_owner("friend")
        self.assertEqual(resolved["kind"], "team")
        self.assertEqual(resolved["owner_user_id"], "host")

    def test_cannot_share_until_signed_in(self) -> None:
        self.signed_in.discard("host")
        with self.assertRaises(ValueError):
            share.share_with_team("team1", "host")

    def test_add_personal_person_without_workspace_membership(self) -> None:
        with get_conn() as conn:
            conn.execute(
                "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,?)",
                ("friend", "friend@example.com", "Friend", "x", "2026-01-01T00:00:00+00:00"),
            )
            conn.commit()
        pending = share.add_personal_person("host", email="friend@example.com")
        self.assertEqual(pending["status"], "needs_confirm")
        result = share.add_personal_person(
            "host",
            email="friend@example.com",
            confirm_new_collaborator=True,
        )
        self.assertEqual(result["status"], "added")
        self.assertTrue(result.get("chatgpt_granted"))
        self.assertFalse(result["person"].get("workspace_member"))
        self.assertFalse(share.is_workspace_member_of_owner("host", "friend"))
        with get_conn() as conn:
            members = conn.execute(
                "SELECT 1 FROM team_members WHERE user_id=?",
                ("friend",),
            ).fetchall()
        self.assertEqual(len(members), 0)
        resolved = share.resolve_codex_owner("friend")
        self.assertEqual(resolved["kind"], "personal")
        self.assertEqual(resolved["owner_user_id"], "host")

    def test_remove_personal_person(self) -> None:
        with get_conn() as conn:
            conn.execute(
                "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,?)",
                ("gone", "gone@example.com", "Gone", "x", "2026-01-01T00:00:00+00:00"),
            )
            conn.commit()
        share.add_personal_person("host", email="gone@example.com", confirm_new_collaborator=True)
        self.assertEqual(len(share.list_personal_people("host")), 1)
        share.remove_personal_person("host", "gone")
        self.assertEqual(share.list_personal_people("host"), [])
        resolved = share.resolve_codex_owner("gone")
        self.assertIsNone(resolved["owner_user_id"])

    def test_personal_received_payload_exposes_grant_and_owner_status(self) -> None:
        added = share.add_personal_person("host", user_id="newbie", confirm_new_collaborator=True)
        received = share.listing_for_user("newbie")["personal_received"]
        self.assertEqual(len(received), 1)
        self.assertEqual(received[0]["id"], added["person"]["grant_id"])
        self.assertTrue(received[0]["granted"])
        self.assertTrue(received[0]["owner_signed_in"])
        self.assertEqual(received[0]["kind"], "personal")
        self.assertEqual(received[0]["owner_user_id"], "host")
        self.assertFalse(share.listing_for_user("newbie")["signed_in"])
        self.signed_in.remove("host")
        pending = share.list_personal_received("newbie")[0]
        self.assertTrue(pending["granted"])
        self.assertFalse(pending["owner_signed_in"])
        share.set_personal_person_access("host", "newbie", granted=False)
        self.assertEqual(share.list_personal_received("newbie"), [])

    def test_manage_keys_lists_personal_received_without_management_access(self) -> None:
        share.add_personal_person("host", user_id="newbie", confirm_new_collaborator=True)
        rows = share.status_rows_for_user("newbie")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["name"], "ChatGPT · Sam W")
        self.assertEqual(rows[0]["kind"], "personal")
        self.assertTrue(rows[0]["granted"])
        self.assertFalse(rows[0]["is_owner"])
        self.assertFalse(rows[0]["can_manage"])
        self.assertNotIn("team_id", rows[0])
        self.signed_in.remove("host")
        self.assertFalse(share.status_rows_for_user("newbie")[0]["owner_signed_in"])
        share.set_personal_person_access("host", "newbie", granted=False)
        self.assertEqual(share.status_rows_for_user("newbie"), [])

    def test_personal_daily_limit_save_and_enforce(self) -> None:
        with get_conn() as conn:
            conn.execute(
                "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,?)",
                ("capped", "capped@example.com", "Capped", "x", "2026-01-01T00:00:00+00:00"),
            )
            conn.commit()
        share.add_personal_person(
            "host",
            email="capped@example.com",
            daily_limit_usd=5,
            confirm_new_collaborator=True,
        )
        people = share.set_personal_person_access(
            "host",
            "capped",
            daily_limit_usd=2,
            daily_limit_provided=True,
        )
        row = next(p for p in people if p["user_id"] == "capped")
        self.assertEqual(row["daily_limit_usd"], 2)
        under = share.resolve_codex_owner("capped", spent_today_usd=1.5)
        self.assertEqual(under["kind"], "personal")
        blocked = share.resolve_codex_owner("capped", spent_today_usd=2)
        self.assertEqual(blocked["kind"], "daily_limit")
        self.assertIsNone(blocked["owner_user_id"])

    def test_workspace_daily_limit_save(self) -> None:
        share.share_with_team("team1", "host")
        share_id = share.list_team_shares("team1", "host")[0]["id"]
        members = share.set_member_access(
            "team1",
            share_id,
            "mate",
            granted=True,
            requester_id="host",
            daily_limit_usd=3.5,
            daily_limit_provided=True,
        )
        mate = next(m for m in members if m["user_id"] == "mate")
        self.assertEqual(mate["daily_limit_usd"], 3.5)
        blocked = share.resolve_codex_owner("mate", spent_today_usd=3.5)
        self.assertEqual(blocked["kind"], "daily_limit")


class SignupTrialGrantTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "t.db"
        self.db_patch = patch("backend.database.DB_PATH", self.db)
        self.db_patch.start()
        init_db()
        with get_conn() as conn:
            conn.execute(
                "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,?)",
                ("u1", "u1@example.com", "User One", "x", "2026-01-01T00:00:00+00:00"),
            )
            conn.commit()

    def tearDown(self) -> None:
        self.db_patch.stop()
        self.tmp.cleanup()

    def test_new_grant_is_three_renders_not_ten_dollars(self) -> None:
        from backend.services import ai_credit_service

        with patch("backend.request_context.get_client_ip", return_value="9.9.9.9"):
            info = ai_credit_service.grant_signup_trial_if_needed({"id": "u1"})
        self.assertTrue(info.get("just_granted") or info.get("granted"))
        self.assertEqual(info.get("kind"), "chatgpt_renders")
        self.assertEqual(info.get("renders_limit"), 3)
        self.assertEqual(info.get("renders_remaining"), 3)
        self.assertEqual(int(info.get("amount_cents") or 0), 0)
        account = ai_credit_service.ensure_account("u1")
        self.assertFalse(str(account.get("trial_granted_at") or "").strip())
        self.assertEqual(int(account.get("balance_cents") or 0), 0)


if __name__ == "__main__":
    unittest.main()
