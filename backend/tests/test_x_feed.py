"""Combined Updates X feed — merge, cache, never leak tokens."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from backend.services import x_feed_service as feed


class XFeedServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        feed._memory = None
        feed._memory_at = 0.0

    def test_expand_text_replaces_tco(self) -> None:
        text = feed._expand_text({
            "text": "Shipped https://t.co/abc",
            "entities": {"urls": [{"url": "https://t.co/abc", "expanded_url": "https://render3d.app/updates.html"}]},
        })
        self.assertIn("render3d.app", text)
        self.assertNotIn("t.co/abc", text)

    def test_public_feed_empty_when_unconfigured(self) -> None:
        with patch.object(feed, "_bearer", return_value=""), patch.object(
            feed, "_fetch_fx_handle", side_effect=RuntimeError("fx_offline")
        ):
            payload = feed.public_feed(force=True)
        self.assertFalse(payload["ok"])
        self.assertIn(payload["reason"], {"not_configured", "fetch_failed"})
        self.assertEqual(payload["tweets"], [])
        blob = str(payload)
        self.assertNotIn("Bearer", blob)
        self.assertNotIn("Authorization", blob)

    def test_merges_two_accounts_newest_first(self) -> None:
        users = {
            "a1_projects": {"id": "1", "name": "A1", "username": "a1_projects", "profile_image_url": ""},
            "winstead_works": {"id": "2", "name": "Winstead", "username": "winstead_works", "profile_image_url": ""},
        }

        def fake_lookup(_client, handle: str):
            return users[handle]

        def fake_tweets(_client, user_id: str):
            if user_id == "1":
                return ([{"id": "10", "text": "older", "created_at": "2026-09-01T10:00:00.000Z"}], {})
            return ([{"id": "20", "text": "newer", "created_at": "2026-09-16T10:00:00.000Z"}], {})

        with patch.object(feed, "_bearer", return_value="test-token-not-real"), patch.object(
            feed, "_lookup_user", side_effect=fake_lookup
        ), patch.object(feed, "_user_tweets", side_effect=fake_tweets), patch.object(
            feed, "_save_disk_cache"
        ):
            payload = feed.public_feed(force=True)
        self.assertTrue(payload["ok"])
        self.assertEqual([row["id"] for row in payload["tweets"]], ["20", "10"])
        self.assertEqual(payload["tweets"][0]["author"]["username"], "winstead_works")
        self.assertTrue(payload["tweets"][0]["url"].endswith("/status/20"))
        self.assertNotIn("test-token-not-real", str(payload))

    def test_fx_item_maps_profile_and_media(self) -> None:
        item = {
            "id": "99",
            "text": "Hello from X",
            "created_timestamp": 1789565803,
            "url": "https://x.com/A1_Projects/status/99",
            "author": {"screen_name": "A1_Projects", "name": "Sam W", "avatar_url": "https://pbs.twimg.com/a_normal.jpg"},
            "media": {"photos": [{"type": "photo", "url": "https://pbs.twimg.com/media/one.jpg"}]},
            "replying_to": None,
        }
        row = feed._from_fx_item(item, "a1_projects")
        self.assertEqual(row["id"], "99")
        self.assertEqual(row["author"]["username"], "A1_Projects")
        self.assertTrue(row["media"][0]["src"].endswith("one.jpg"))
        self.assertTrue(row["created_at"].startswith("2026-"))

    def test_rate_limit_serves_stale_cache(self) -> None:
        stale = {
            "ok": True,
            "reason": "",
            "handles": list(feed.HANDLES),
            "tweets": [{"id": "1", "text": "cached", "created_at": "2026-09-01T00:00:00.000Z", "url": "https://x.com/a/status/1", "author": {"username": "a1_projects"}, "media": []}],
            "profiles": [],
            "fetched_at": 1,
            "cached": False,
        }
        feed._memory = stale
        feed._memory_at = 0.0
        with patch.object(feed, "_bearer", return_value="test-token-not-real"), patch.object(
            feed, "_fetch_live", return_value={"ok": False, "reason": "rate_limited", "tweets": [], "handles": list(feed.HANDLES), "profiles": [], "fetched_at": 99}
        ), patch.object(feed, "_load_disk_cache", return_value=None):
            payload = feed.public_feed(force=True)
        self.assertTrue(payload["stale"])
        self.assertEqual(payload["tweets"][0]["id"], "1")
        self.assertEqual(payload["reason"], "rate_limited")

    def test_public_feed_pages_and_caps_at_200(self) -> None:
        rows = [
            {
                "id": str(i),
                "text": f"t{i}",
                "created_at": f"2026-08-{(i % 28) + 1:02d}T10:00:00.000Z",
                "url": f"https://x.com/a/status/{i}",
                "author": {"username": "a1_projects"},
                "media": [],
            }
            for i in range(250)
        ]
        live = {
            "ok": True,
            "reason": "",
            "handles": list(feed.HANDLES),
            "tweets": rows[: feed.MAX_MERGED],
            "profiles": [],
            "fetched_at": 99,
            "cached": False,
        }
        with patch.object(feed, "_fetch_live", return_value=live), patch.object(feed, "_save_disk_cache"):
            page = feed.public_feed(force=True, offset=40, limit=20)
        self.assertEqual(len(page["tweets"]), 20)
        self.assertEqual(page["tweets"][0]["id"], "40")
        self.assertEqual(page["total"], 200)
        self.assertTrue(page["has_more"])
        self.assertEqual(page["max"], 200)
        last = feed.public_feed(offset=180, limit=40)
        self.assertEqual(len(last["tweets"]), 20)
        self.assertFalse(last["has_more"])


if __name__ == "__main__":
    unittest.main()
