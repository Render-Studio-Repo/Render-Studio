"""Users activity summary columns increment from existing feedback / chat paths."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import feedback_service, supabase_users_store as sbusers


class UserActivityCountsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.data = Path(self.tmp.name)
        self.fb_patch = patch("backend.services.feedback_service.settings.data_dir", str(self.data))
        self.fb_patch.start()

    def tearDown(self) -> None:
        self.fb_patch.stop()
        self.tmp.cleanup()

    def test_activity_column_map(self) -> None:
        self.assertEqual(sbusers.ACTIVITY_COLUMNS["suggestion"], "suggestions_count")
        self.assertEqual(sbusers.ACTIVITY_COLUMNS["bug"], "bug_requests_count")
        self.assertEqual(sbusers.ACTIVITY_COLUMNS["render_agent"], "render_agent_questions_count")
        self.assertEqual(sbusers.ACTIVITY_COLUMNS["chat"], "chats_sent_count")

    def test_increment_skips_when_disabled_or_anonymous(self) -> None:
        with patch.object(sbusers, "enabled", return_value=False):
            self.assertFalse(sbusers.increment_activity("u1", "bug"))
        with patch.object(sbusers, "enabled", return_value=True):
            self.assertFalse(sbusers.increment_activity("", "bug"))
            self.assertFalse(sbusers.increment_activity("u1", "unknown"))

    def test_feedback_increments_bug_and_suggestion(self) -> None:
        calls: list[tuple[str, str]] = []

        def fake_inc(uid: str, kind: str) -> bool:
            calls.append((uid, kind))
            return True

        user = {"id": "u1", "email": "ada@example.com", "display_name": "Ada"}
        with patch.object(sbusers, "increment_activity", side_effect=fake_inc):
            bug = feedback_service.add_request(kind="bug", message="Viewport froze on orbit", user=user)
            idea = feedback_service.add_request(kind="suggestion", message="Keep the suggestions popup", user=user)
        self.assertEqual(bug["kind"], "bug")
        self.assertEqual(idea["kind"], "suggestion")
        self.assertEqual(calls, [("u1", "bug"), ("u1", "suggestion")])

    def test_anonymous_feedback_does_not_increment(self) -> None:
        with patch.object(sbusers, "increment_activity") as inc:
            feedback_service.add_request(kind="bug", message="Guest saw a crash overlay", user={})
        inc.assert_not_called()
