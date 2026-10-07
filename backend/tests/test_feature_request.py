"""Admin settings catalog + feature-request notify gate."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import dashboard_settings_catalog, feature_request_service, site_settings_service


class SettingsCatalogTests(unittest.TestCase):
    def test_search_finds_server_and_pref_rows(self):
        hits = dashboard_settings_catalog.search_settings("feature request")
        ids = {item["id"] for item in hits}
        self.assertTrue(ids & {"server-feature-request-notify", "pref-feature-request-notify"})
        theme = dashboard_settings_catalog.search_settings("dark theme")
        self.assertTrue(any(item["id"] == "pref-theme" for item in theme))
        robot = dashboard_settings_catalog.search_settings("robot host ip")
        self.assertTrue(any(item["id"] == "pref-robot-host-ip" for item in robot))
        self.assertEqual(dashboard_settings_catalog.search_settings("zzzz-no-such-setting"), [])

    def test_setting_question_heuristic(self):
        self.assertTrue(dashboard_settings_catalog.looks_like_setting_question("Where is the overnight export setting?"))
        self.assertFalse(dashboard_settings_catalog.looks_like_setting_question("How do I fillet an edge?"))


class FeatureRequestNotifyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.data = Path(self.tmp.name)
        self.patcher = patch("backend.services.site_settings_service.settings.data_dir", str(self.data))
        self.fr_patch = patch("backend.services.feature_request_service.settings.data_dir", str(self.data))
        self.patcher.start()
        self.fr_patch.start()

    def tearDown(self) -> None:
        self.fr_patch.stop()
        self.patcher.stop()
        self.tmp.cleanup()

    def test_notify_off_skips_github_and_email(self):
        site_settings_service.save({"feature_request_notify_enabled": False})
        with (
            patch("backend.services.github_issues_service.create_feature_request_issue") as gh,
            patch("backend.services.feature_request_service._email_sam") as mail,
        ):
            result = feature_request_service.submit_feature_request(
                user={"id": "u1", "email": "sam@render3d.app", "display_name": "Sam"},
                title="Overnight Fusion export",
                body="Please add a setting to auto-export to Fusion at 2am.",
                setting_query="overnight fusion export",
            )
        gh.assert_not_called()
        mail.assert_not_called()
        self.assertTrue(result["ok"])
        self.assertFalse(result["notified"])
        self.assertIn("off", result["detail"].lower())

    def test_notify_on_calls_github_and_email(self):
        site_settings_service.save({"feature_request_notify_enabled": True})
        with (
            patch(
                "backend.services.github_issues_service.create_feature_request_issue",
                return_value={"ok": True, "html_url": "https://github.com/wprojects/Render-Studio/issues/1", "number": 1},
            ) as gh,
            patch("backend.services.feature_request_service._email_sam", return_value={"ok": True, "to": "sam@render3d.app"}) as mail,
        ):
            result = feature_request_service.submit_feature_request(
                user={"id": "u1", "email": "a1projects@protonmail.com", "display_name": "A1"},
                title="Missing setting",
                body="Need a FOV lock toggle",
                setting_query="fov lock",
            )
        gh.assert_called_once()
        mail.assert_called_once()
        self.assertTrue(result["notified"])
        self.assertEqual(result["label"], "feature-request")


if __name__ == "__main__":
    unittest.main()
