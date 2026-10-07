from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import instance_release_service as releases


class InstanceReleaseServiceTests(unittest.TestCase):
    def test_signed_publish_round_trips_stable_release(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, patch.object(releases, "_path", return_value=Path(tmp) / "release.json"), patch.object(releases.settings, "render3d_release_webhook_token", "secret"):
            published = releases.publish({
                "repository": "wprojects/Render-Studio",
                "branch": "master",
                "commit_sha": "a" * 40,
                "notes": "feat: safe instance updates\nDetails",
                "published_at": "2026-10-06T20:00:00Z",
            }, "secret")
            self.assertEqual(releases.latest(), published)
            self.assertEqual(published["notes"], "feat: safe instance updates")

    def test_invalid_token_is_rejected(self) -> None:
        with patch.object(releases.settings, "render3d_release_webhook_token", "secret"):
            with self.assertRaises(PermissionError):
                releases.publish({}, "wrong")

    def test_non_stable_source_is_rejected(self) -> None:
        with patch.object(releases.settings, "render3d_release_webhook_token", "secret"):
            with self.assertRaisesRegex(ValueError, "official stable branch"):
                releases.publish({"repository": "wprojects/Render-Studio", "branch": "feature", "commit_sha": "a" * 40}, "secret")


if __name__ == "__main__":
    unittest.main()
