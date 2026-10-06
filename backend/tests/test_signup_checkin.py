"""Signup check-in: delayed founder email and reply SMS."""

from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path
from unittest.mock import MagicMock, patch

from backend.database import get_conn, init_db
from backend.services import signup_checkin_service as checkin


NOW = datetime(2026, 9, 7, 17, 0, tzinfo=timezone.utc)


def _iso(days_ago: float) -> str:
    return (NOW - timedelta(days=days_ago)).isoformat()


class FakeSMTP:
    sent: list[EmailMessage] = []

    def __init__(self, *args: object, **kwargs: object) -> None:
        pass

    def __enter__(self) -> FakeSMTP:
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def ehlo(self) -> None:
        return None

    def starttls(self) -> None:
        return None

    def login(self, *args: object) -> None:
        return None

    def send_message(self, msg: EmailMessage) -> None:
        FakeSMTP.sent.append(msg)


class SignupCheckinTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "t.db"
        self.db_patch = patch("backend.database.DB_PATH", self.db)
        self.db_patch.start()
        init_db()
        checkin.ensure_schema()
        FakeSMTP.sent = []
        self.smtp_patch = patch.object(checkin.settings, "capacity_alert_smtp_user", "info@render3d.app")
        self.pass_patch = patch.object(checkin.settings, "capacity_alert_smtp_password", "app-password")
        self.from_patch = patch.object(checkin.settings, "capacity_alert_from", "info@render3d.app")
        self.smtp_patch.start()
        self.pass_patch.start()
        self.from_patch.start()

    def tearDown(self) -> None:
        self.from_patch.stop()
        self.pass_patch.stop()
        self.smtp_patch.stop()
        self.db_patch.stop()
        self.tmp.cleanup()

    def _add_user(
        self,
        user_id: str,
        email: str,
        name: str,
        *,
        days_ago: float,
    ) -> dict[str, str]:
        created = _iso(days_ago)
        with get_conn() as conn:
            conn.execute(
                "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,?)",
                (user_id, email, name, "x", created),
            )
            conn.commit()
        return {"id": user_id, "email": email, "display_name": name, "created_at": created}

    def test_window_skips_too_new_not_too_old(self) -> None:
        self.assertFalse(checkin.in_window(_iso(2), now=NOW))
        self.assertTrue(checkin.in_window(_iso(3), now=NOW))
        self.assertTrue(checkin.in_window(_iso(13.9), now=NOW))
        self.assertTrue(checkin.in_window(_iso(14), now=NOW))
        self.assertTrue(checkin.in_window(_iso(20), now=NOW))

    def test_skips_placeholder_self_and_test_domains(self) -> None:
        self._add_user("u-new", "fresh@gmail.com", "Fresh", days_ago=1)
        self._add_user("u-example", "old@example.com", "Old", days_ago=20)
        self._add_user("u-social", "abc@social.render3d.local", "Social", days_ago=4)
        self._add_user("u-sam", "sam@render3d.app", "Sam", days_ago=4)
        self._add_user("u-old", "peter@plynth.build", "Peter", days_ago=20)
        self._add_user("u-ok", "mumu@gmail.com", "王沐沐", days_ago=4)
        ids = {u["id"] for u in checkin.eligible_users(now=NOW)}
        self.assertEqual(ids, {"u-old", "u-ok"})

    def test_old_account_copy_is_a_check_in(self) -> None:
        template = checkin.render_checkin_email(
            {"display_name": "Peter", "email": "peter@plynth.build", "created_at": _iso(20)},
            now=NOW,
        )
        self.assertIn("check in", template["text"])
        self.assertNotIn("few days", template["text"])

    def test_trickle_caps_per_hour(self) -> None:
        for i in range(6):
            self._add_user(f"u-{i}", f"user{i}@gmail.com", f"User{i}", days_ago=20)
        with (
            patch("backend.services.signup_checkin_service.smtplib.SMTP", FakeSMTP),
            patch("backend.services.signup_checkin_service._now", return_value=NOW),
        ):
            first = checkin.send_due_checkins(now=NOW, limit=4, pause_sec=0, respect_hours=False)
            second = checkin.send_due_checkins(now=NOW, limit=4, pause_sec=0, respect_hours=False)
        self.assertEqual(first["sent"], 4)
        self.assertEqual(second["sent"], 0)
        self.assertEqual(second.get("reason"), "hourly_cap")
        self.assertEqual(len(FakeSMTP.sent), 4)

    def test_outside_hours_pauses(self) -> None:
        self._add_user("u-ok", "mumu@gmail.com", "王沐沐", days_ago=20)
        night = datetime(2026, 9, 8, 4, 0, tzinfo=timezone.utc)  # 11pm Chicago
        with patch("backend.services.signup_checkin_service.smtplib.SMTP", FakeSMTP):
            result = checkin.send_due_checkins(now=night, pause_sec=0)
        self.assertEqual(result["sent"], 0)
        self.assertTrue(result.get("paused"))
        self.assertEqual(len(FakeSMTP.sent), 0)

    def test_render_email_is_from_sam_and_offers_help(self) -> None:
        user = {"display_name": "王沐沐", "email": "mumu@gmail.com"}
        template = checkin.render_checkin_email(user)
        self.assertEqual(template["subject"], "How's Render Studio going?")
        self.assertIn("王沐沐", template["text"])
        self.assertIn("how it's going", template["text"])
        self.assertIn("anything I can do to help", template["text"])
        msg = checkin.build_checkin_message(user, token="abc123")
        self.assertIn("Sam Winstead", msg["From"])
        self.assertIn("info@render3d.app", msg["From"])
        self.assertEqual(msg["To"], "mumu@gmail.com")
        self.assertIsNone(msg["Cc"])
        self.assertIsNone(msg["Bcc"])
        self.assertIn("info@render3d.app", msg["Reply-To"])
        self.assertNotIn("sam@render3d.app", msg["Reply-To"] or "")
        self.assertIn("rs-checkin-abc123@render3d.app", msg["Message-ID"])

    def test_send_once(self) -> None:
        user = self._add_user("u-ok", "mumu@gmail.com", "王沐沐", days_ago=4)
        with patch("backend.services.signup_checkin_service.smtplib.SMTP", FakeSMTP):
            first = checkin.send_checkin(user)
            second = checkin.send_checkin(user)
        self.assertTrue(first["ok"])
        self.assertFalse(first.get("skipped"))
        self.assertTrue(second["ok"])
        self.assertTrue(second.get("skipped"))
        self.assertEqual(len(FakeSMTP.sent), 1)
        self.assertIsNone(FakeSMTP.sent[0]["Cc"])
        self.assertIsNone(FakeSMTP.sent[0]["Bcc"])
        due = checkin.eligible_users(now=NOW)
        self.assertEqual(due, [])

    def test_reply_in_reply_to_texts_once(self) -> None:
        user = self._add_user("u-ok", "mumu@gmail.com", "王沐沐", days_ago=4)
        with patch("backend.services.signup_checkin_service.smtplib.SMTP", FakeSMTP):
            sent = checkin.send_checkin(user)
        reply = EmailMessage()
        reply["From"] = "王沐沐 <mumu@gmail.com>"
        reply["To"] = "Sam Winstead <info@render3d.app>"
        reply["Subject"] = "Re: How's Render Studio going?"
        reply["In-Reply-To"] = sent["message_id"]
        reply.set_content("The extrude tool is confusing — can you walk me through it?")
        sms_calls: list[str] = []

        def _sms(body: str, *, to: str = "") -> dict[str, object]:
            sms_calls.append(body)
            return {"ok": True, "sid": "SM1", "to": to}

        FakeSMTP.sent = []
        with (
            patch("backend.services.signup_checkin_service.sms_notify.send_sms", _sms),
            patch("backend.services.signup_checkin_service.smtplib.SMTP", FakeSMTP),
        ):
            first = checkin.process_inbound_message(reply)
            second = checkin.process_inbound_message(reply)
        self.assertTrue(first["ok"])
        self.assertFalse(first.get("skipped"))
        self.assertTrue(second.get("skipped"))
        self.assertEqual(len(sms_calls), 1)
        self.assertIn("王沐沐", sms_calls[0])
        self.assertIn("mumu@gmail.com", sms_calls[0])
        self.assertIn("extrude", sms_calls[0])
        self.assertEqual(len(FakeSMTP.sent), 1)
        alert = FakeSMTP.sent[0]
        self.assertEqual(alert["To"], "sam@render3d.app")
        self.assertEqual(alert["Reply-To"], "mumu@gmail.com")
        self.assertIn("Reply from 王沐沐", alert["Subject"])
        self.assertIn("mumu@gmail.com", alert.get_content())
        self.assertIn("extrude", alert.get_content())

    def test_reply_matches_subject_and_from(self) -> None:
        self._add_user("u-ok", "mumu@gmail.com", "王沐沐", days_ago=4)
        with get_conn() as conn:
            conn.execute(
                """
                INSERT INTO signup_checkins
                    (user_id, email, display_name, token, message_id, sent_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    "u-ok",
                    "mumu@gmail.com",
                    "王沐沐",
                    "tokentoken",
                    "<rs-checkin-tokentoken@render3d.app>",
                    NOW.isoformat(),
                ),
            )
            conn.commit()
        matched = checkin.match_checkin(
            from_email="mumu@gmail.com",
            subject="Re: How's Render Studio going?",
            in_reply_to="",
            references="",
            body="Looks great so far.",
        )
        self.assertIsNotNone(matched)
        assert matched is not None
        self.assertEqual(matched["user_id"], "u-ok")

    def test_imap_poll_sends_sms(self) -> None:
        user = self._add_user("u-ok", "mumu@gmail.com", "王沐沐", days_ago=4)
        with patch("backend.services.signup_checkin_service.smtplib.SMTP", FakeSMTP):
            sent = checkin.send_checkin(user)
        raw = (
            f"From: 王沐沐 <mumu@gmail.com>\r\n"
            f"Subject: Re: How's Render Studio going?\r\n"
            f"In-Reply-To: {sent['message_id']}\r\n"
            f"Content-Type: text/plain; charset=utf-8\r\n"
            f"\r\n"
            f"Need a hand with assemblies.\r\n"
        ).encode("utf-8")
        client = MagicMock()
        client.select.return_value = ("OK", [b"1"])
        client.search.return_value = ("OK", [b"1"])
        client.fetch.return_value = ("OK", [(b"1", raw)])
        sms_calls: list[str] = []

        def _sms(body: str, *, to: str = "") -> dict[str, object]:
            sms_calls.append(body)
            return {"ok": True, "to": to}

        FakeSMTP.sent = []
        with (
            patch("backend.services.signup_checkin_service._imap_login", return_value=client),
            patch("backend.services.signup_checkin_service.sms_notify.send_sms", _sms),
            patch("backend.services.signup_checkin_service.smtplib.SMTP", FakeSMTP),
        ):
            result = checkin.poll_replies()
        self.assertTrue(result["ok"])
        self.assertEqual(result["matched"], 1)
        self.assertEqual(len(sms_calls), 1)
        self.assertIn("assemblies", sms_calls[0])
        self.assertEqual(len(FakeSMTP.sent), 1)
        self.assertEqual(FakeSMTP.sent[0]["To"], "sam@render3d.app")
        self.assertIn("assemblies", FakeSMTP.sent[0].get_content())

    def test_sms_failure_emails_sam(self) -> None:
        self._add_user("u-ok", "mumu@gmail.com", "王沐沐", days_ago=4)
        with get_conn() as conn:
            conn.execute(
                """
                INSERT INTO signup_checkins
                    (user_id, email, display_name, token, message_id, sent_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    "u-ok",
                    "mumu@gmail.com",
                    "王沐沐",
                    "tokentoken",
                    "<rs-checkin-tokentoken@render3d.app>",
                    NOW.isoformat(),
                ),
            )
            conn.commit()
        reply = EmailMessage()
        reply["From"] = "mumu@gmail.com"
        reply["Subject"] = "Re: How's Render Studio going?"
        reply["In-Reply-To"] = "<rs-checkin-tokentoken@render3d.app>"
        reply.set_content("Can you help?")
        with (
            patch(
                "backend.services.signup_checkin_service.sms_notify.send_sms",
                return_value={"ok": False, "error": "Twilio not configured"},
            ),
            patch("backend.services.signup_checkin_service.smtplib.SMTP", FakeSMTP),
        ):
            result = checkin.process_inbound_message(reply)
        self.assertTrue(result["ok"])
        self.assertEqual(len(FakeSMTP.sent), 1)
        self.assertEqual(FakeSMTP.sent[0]["To"], "sam@render3d.app")
        self.assertEqual(FakeSMTP.sent[0]["Reply-To"], "mumu@gmail.com")
        self.assertIn("Reply from 王沐沐", FakeSMTP.sent[0]["Subject"])
        self.assertIn("Can you help?", FakeSMTP.sent[0].get_content())


if __name__ == "__main__":
    unittest.main()
