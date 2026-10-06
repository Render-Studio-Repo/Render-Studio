"""Calendar privacy, Meet accept payload, reminders, and org invite email."""

from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from backend.database import get_conn, init_db
from backend.services import calendar_service, email_notification_service, profile_service


class CalendarMeetingsTests(unittest.TestCase):
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
                ("alice", "alice@example.com", "Alice", "x", now),
            )
            conn.execute(
                "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,?)",
                ("bob", "bob@example.com", "Bob", "x", now),
            )
            conn.commit()
        calendar_service._ensure()

    def tearDown(self) -> None:
        self.db_patch.stop()
        self.tmp.cleanup()

    def test_org_invite_uses_info_render(self) -> None:
        email = calendar_service.org_invite_email()
        self.assertIn("@", email)
        self.assertTrue(email.endswith("render3d.app") or email == "info@render3d.app")
        attendees = calendar_service.unique_attendee_emails("alice@example.com", "bob@example.com")
        self.assertIn("alice@example.com", attendees)
        self.assertIn("bob@example.com", attendees)
        self.assertIn(email, attendees)

    def test_internal_calendar_hides_busy_from_others(self) -> None:
        calendar_service.set_privacy("bob", visibility="internal")
        calendar_service._cache_busy(
            "bob",
            "google",
            [{"starts_at": "2026-09-08T16:00:00+00:00", "ends_at": "2026-09-08T17:00:00+00:00", "title": "Secret"}],
        )
        other = calendar_service.calendar_view_for_viewer("bob", {"id": "alice"})
        self.assertFalse(other["can_view"])
        self.assertTrue(other["internal_only"])
        self.assertEqual(other["busy"], [])
        blob = json.dumps(other)
        self.assertNotIn("Secret", blob)
        own = calendar_service.calendar_view_for_viewer("bob", {"id": "bob"})
        self.assertTrue(own["can_view"])
        self.assertTrue(own["busy"])

    def test_public_calendar_shows_busy_not_titles_by_default(self) -> None:
        calendar_service.set_privacy("bob", visibility="public")
        calendar_service._cache_busy(
            "bob",
            "google",
            [{"starts_at": "2026-09-08T16:00:00+00:00", "ends_at": "2026-09-08T17:00:00+00:00", "title": "Secret standup"}],
        )
        view = calendar_service.calendar_view_for_viewer("bob", {"id": "alice"})
        self.assertTrue(view["can_view"])
        self.assertEqual(view["busy"][0]["title"], "Busy")

    def test_google_meet_payload_has_conference_and_30m_reminder(self) -> None:
        start = datetime(2026, 9, 8, 16, 0, tzinfo=timezone.utc)
        end = start + timedelta(minutes=30)
        payload = calendar_service.google_meet_event_payload(
            title="Studio meeting",
            description="Hello",
            starts_at=start,
            ends_at=end,
            attendee_emails=["alice@example.com", "bob@example.com"],
            include_email_reminder=True,
            request_id="abc123",
        )
        self.assertEqual(payload["conferenceData"]["createRequest"]["conferenceSolutionKey"]["type"], "hangoutsMeet")
        methods = {o["method"]: o["minutes"] for o in payload["reminders"]["overrides"]}
        self.assertEqual(methods["popup"], 30)
        self.assertEqual(methods["email"], 30)
        emails = [a["email"] for a in payload["attendees"]]
        self.assertIn("alice@example.com", emails)
        self.assertIn(calendar_service.org_invite_email(), emails)

    def test_accept_creates_meet_and_sets_reminder(self) -> None:
        start = datetime.now(timezone.utc) + timedelta(hours=2)
        end = start + timedelta(minutes=30)
        req = profile_service.create_meeting_request(
            from_user={"id": "alice", "email": "alice@example.com", "display_name": "Alice", "handle": "alice"},
            to_user_id="bob",
            message="Let's review CAD",
            starts_at=start.isoformat(),
            ends_at=end.isoformat(),
            send_email=False,
        )

        def google_post(url, **kwargs):
            self.assertIn("conferenceDataVersion", kwargs.get("params") or {})
            return {
                "id": "evt-1",
                "hangoutLink": "https://meet.google.com/abc-defg-hij",
                "conferenceData": {
                    "entryPoints": [{"entryPointType": "hangoutsMeet", "uri": "https://meet.google.com/abc-defg-hij"}]
                },
            }

        with patch.object(calendar_service, "_connection_row") as conn_row:
            conn_row.side_effect = lambda user_id, provider: (
                {
                    "user_id": user_id,
                    "provider": "google",
                    "access_token": "tok",
                    "refresh_token": "r",
                    "expires_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
                    "email": "bob@example.com",
                }
                if provider == "google" and user_id == "bob"
                else None
            )
            with patch.object(calendar_service, "_valid_access_token", return_value="tok"):
                with patch("backend.services.social_service.send_calendar_invite_email", return_value={"ok": True}):
                    result = calendar_service.accept_meeting_request(
                        req["id"],
                        {"id": "bob"},
                        google_post=google_post,
                    )
        self.assertEqual(result["status"], "accepted")
        self.assertEqual(result["meet_url"], "https://meet.google.com/abc-defg-hij")
        self.assertEqual(result["reminder_minutes"], 30)
        stored = profile_service.get_meeting_request(req["id"])
        self.assertEqual(stored["status"], "accepted")
        self.assertTrue(stored.get("reminder_due_at"))

    def test_meeting_reminders_pref_defaults_on(self) -> None:
        prefs = email_notification_service.get_preferences("alice")
        self.assertTrue(prefs["meeting_reminders"])
        email_notification_service.update_preferences("alice", {"meeting_reminders": False})
        self.assertFalse(email_notification_service.user_allows_email("alice", "meeting_reminders"))

    def test_ics_has_30_minute_alarm(self) -> None:
        from backend.services.social_service import build_ics

        start = datetime(2026, 9, 8, 16, 0, tzinfo=timezone.utc)
        ics = build_ics(
            uid="x@render3d.app",
            title="Meet",
            description="Hi",
            starts_at=start,
            ends_at=start + timedelta(minutes=30),
            organizer_email="info@render3d.app",
            attendee_emails=["alice@example.com"],
            reminder_minutes=30,
            reminder_email=True,
        )
        self.assertIn("BEGIN:VALARM", ics)
        self.assertIn("TRIGGER:-PT30M", ics)
        self.assertIn("ACTION:EMAIL", ics)

    def test_profile_tabs_settings_only_for_self(self) -> None:
        mine = profile_service.public_profile("alice", viewer={"id": "alice"})
        other = profile_service.public_profile("bob", viewer={"id": "alice"})
        self.assertIn("settings", mine["tabs"])
        self.assertNotIn("settings", other["tabs"])
        self.assertIn("calendar", other["tabs"])
        self.assertIn("store", other["tabs"])
        self.assertIn("activity", other["tabs"])


if __name__ == "__main__":
    unittest.main()
