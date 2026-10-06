"""Boot splash suggestion routing and site settings."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import site_settings_service


class SiteSettingsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.data = Path(self.tmp.name)
        self.patcher = patch("backend.services.site_settings_service.settings.data_dir", str(self.data))
        self.fb_patch = patch("backend.services.feedback_service.settings.data_dir", str(self.data))
        self.patcher.start()
        self.fb_patch.start()
        site_settings_service._rate.clear()

    def tearDown(self) -> None:
        self.fb_patch.stop()
        self.patcher.stop()
        self.tmp.cleanup()

    def test_public_boot_chrome_defaults(self) -> None:
        chrome = site_settings_service.public_boot_chrome()
        self.assertIn("discord.gg", chrome["discord_url"])
        self.assertIn("github.com/wprojects/Render-Studio", chrome["github_url"])
        self.assertIn("x.com/A1_Projects", chrome["x_url"])

    def test_business_inquiry_email_only(self) -> None:
        sent: list[dict] = []

        def fake_mail(*, to, subject, text, attachments=None, from_address=None):
            sent.append({"to": to, "from": from_address, "subject": subject, "text": text, "attachments": attachments or []})
            return {"ok": True, "to": to}

        with patch(
            "backend.services.workspace_automation_service._send_mail",
            side_effect=fake_mail,
        ):
            result = site_settings_service.submit_suggestion(
                kind="business",
                message="Need a volume license quote please",
                user={"email": "buyer@example.com", "display_name": "Buyer"},
            )
        self.assertTrue(result["ok"])
        self.assertTrue(result["emailed"])
        self.assertFalse(result["posted_to_slack"])
        self.assertEqual(len(sent), 1)
        self.assertEqual(sent[0]["to"], ["sam@render3d.app"])
        self.assertEqual(sent[0]["from"], "info@render3d.app")
        self.assertEqual(result["attachment_count"], 0)

    def test_bug_and_idea_email_plus_slack(self) -> None:
        sent: list[list[str]] = []

        def fake_mail(*, to, subject, text, attachments=None, from_address=None):
            sent.append(list(to))
            return {"ok": True, "to": to}

        with patch(
            "backend.services.workspace_automation_service._send_mail",
            side_effect=fake_mail,
        ):
            bug = site_settings_service.submit_suggestion(kind="bug", message="Headset splash frozen on enter")
            idea = site_settings_service.submit_suggestion(kind="idea", message="Add a left-hand dock tutorial")
        self.assertTrue(bug["posted_to_slack"] and idea["posted_to_slack"])
        self.assertEqual(len(sent), 4)
        slack = "suggestions-aaaav3eniyeai4qvwkmfsxknzm@renderserver.slack.com"
        self.assertIn(["sam@render3d.app"], sent)
        self.assertIn([slack], sent)

    def test_slack_off_skips_channel(self) -> None:
        site_settings_service.save({"slack_enabled": False})
        sent: list[list[str]] = []

        def fake_mail(*, to, subject, text, attachments=None, from_address=None):
            sent.append(list(to))
            return {"ok": True, "to": to}

        with patch(
            "backend.services.workspace_automation_service._send_mail",
            side_effect=fake_mail,
        ):
            result = site_settings_service.submit_suggestion(kind="bug", message="Still a bug after the patch")
        self.assertTrue(result["ok"])
        self.assertEqual(sent, [["sam@render3d.app"]])
        self.assertFalse(result["posted_to_slack"])

    def test_attachments_go_to_email_and_slack(self) -> None:
        sent: list[dict] = []

        def fake_mail(*, to, subject, text, attachments=None, from_address=None):
            sent.append({"to": list(to), "text": text, "attachments": attachments or []})
            return {"ok": True, "to": to}

        files = [
            {"filename": "note.txt", "content": b"headset freeze repro", "content_type": "text/plain"},
            {"filename": "shot.png", "content": b"\x89PNG\r\n", "content_type": "image/png"},
        ]
        with patch(
            "backend.services.workspace_automation_service._send_mail",
            side_effect=fake_mail,
        ):
            result = site_settings_service.submit_suggestion(
                kind="bug",
                message="Splash overlay vanished with the boot screen",
                attachments=files,
            )
        self.assertTrue(result["ok"])
        self.assertEqual(result["attachment_count"], 2)
        self.assertEqual(len(sent), 2)
        for item in sent:
            names = [att["filename"] for att in item["attachments"]]
            self.assertEqual(names, ["note.txt", "shot.png"])
            self.assertIn("note.txt", item["text"])

    def test_rejects_exe_and_oversize(self) -> None:
        bad, err = site_settings_service.normalize_attachments(
            [{"filename": "payload.exe", "content": b"MZ", "content_type": "application/octet-stream"}]
        )
        self.assertEqual(bad, [])
        self.assertIn("images", err or "")
        huge, huge_err = site_settings_service.normalize_attachments(
            [{"filename": "wall.pdf", "content": b"x" * (5 * 1024 * 1024 + 20), "content_type": "application/pdf"}]
        )
        self.assertEqual(huge, [])
        self.assertIn("5 MB", huge_err or "")

    def test_submit_writes_inbox_and_notifies_channel(self) -> None:
        from backend.services import feedback_service

        def fake_mail(*, to, subject, text, attachments=None, from_address=None):
            return {"ok": True, "to": to}

        with patch(
            "backend.services.workspace_automation_service._send_mail",
            side_effect=fake_mail,
        ):
            result = site_settings_service.submit_suggestion(
                kind="idea",
                message="Admin inbox should get this note",
                user={"email": "sam@render3d.app", "display_name": "Sam"},
                page_url="https://render3d.app/admin-dashboard.html#suggestions",
            )
        self.assertTrue(result["ok"])
        self.assertTrue(result["emailed"])
        self.assertEqual(result["request"]["kind"], "suggestion")
        items = feedback_service.list_requests()
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["message"], "Admin inbox should get this note")
        self.assertIn("admin-dashboard.html#suggestions", items[0].get("page_url") or "")

    def test_mail_failure_is_not_ok_but_still_records(self) -> None:
        from backend.services import feedback_service

        with patch(
            "backend.services.workspace_automation_service._send_mail",
            return_value={"ok": False, "error": "smtp_not_configured"},
        ):
            result = site_settings_service.submit_suggestion(
                kind="bug",
                message="Headset splash frozen on enter still",
            )
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "smtp_not_configured")
        self.assertEqual(len(feedback_service.list_requests()), 1)


if __name__ == "__main__":
    unittest.main()
