"""Music ranking, gitignore, Grok marketing API (no live YouTube)."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.services import marketing_social_service as social
from backend.services import youtube_music_search as ytm


ROOT = Path(__file__).resolve().parents[2]


class YoutubeRankTests(unittest.TestCase):
    def test_rejects_clean_cover_instrumental(self) -> None:
        self.assertTrue(ytm.is_rejected({"title": "Song (Clean Version)", "uploader": "VEVO"}))
        self.assertTrue(ytm.is_rejected({"title": "Song piano cover", "uploader": "Random"}))
        self.assertTrue(ytm.is_rejected({"title": "Song Instrumental", "uploader": "Topic"}))
        self.assertFalse(ytm.is_rejected({"title": "FE!N (Official Video)", "uploader": "TravisScottVEVO"}))

    def test_official_beats_popular_cover(self) -> None:
        entries = [
            {"id": "cover01xxxx", "title": "FEIN cover", "uploader": "some kid", "view_count": 9_000_000},
            {"id": "officialxxx", "title": "FE!N", "uploader": "Travis Scott - Topic", "view_count": 1000},
        ]
        picked = ytm.pick_best(entries, "Travis Scott FE!N")
        self.assertEqual(picked["id"], "officialxxx")

    def test_falls_back_to_most_popular_when_no_official(self) -> None:
        entries = [
            {"id": "smallxxxxxx", "title": "Song", "uploader": "channel a", "view_count": 10},
            {"id": "bigxxxxxxxx", "title": "Song", "uploader": "random", "view_count": 5_000_000},
        ]
        picked = ytm.pick_best(entries, "Song")
        self.assertEqual(picked["id"], "bigxxxxxxxx")


class MarketingIgnoreTests(unittest.TestCase):
    def test_gitignore_blocks_marketing(self) -> None:
        text = (ROOT / ".gitignore").read_text(encoding="utf-8")
        self.assertIn("Marketing/", text)


class MarketingApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "Music").mkdir(parents=True)
        self.patches = [
            patch.object(social, "ROOT", self.root),
            patch.object(social, "marketing_root", lambda: self.root),
            patch.object(social.settings, "grok_music_api_key", "test-music-key-not-live"),
            patch.object(social.settings, "grok_music_library_dir", str(self.root / "Music" / "library")),
            patch.object(social.settings, "public_base_url", "https://render3d.app"),
        ]
        from backend.config import settings as cfg

        self.patches.append(patch.object(cfg, "grok_music_api_key", "test-music-key-not-live"))
        for p in self.patches:
            p.start()
        from backend.main import app

        self.client = TestClient(app)

    def tearDown(self) -> None:
        for p in reversed(self.patches):
            p.stop()
        self.tmp.cleanup()

    def test_rejects_missing_and_wrong_key(self) -> None:
        blocked = self.client.get("/api/marketing/v1/instructions")
        self.assertEqual(blocked.status_code, 401)
        wrong = self.client.get("/api/marketing/v1/instructions", headers={"Authorization": "Bearer nope"})
        self.assertEqual(wrong.status_code, 401)

    def test_instructions_and_cached_request(self) -> None:
        headers = {"Authorization": "Bearer test-music-key-not-live"}
        playbook = self.client.get("/api/marketing/v1/instructions", headers=headers)
        self.assertEqual(playbook.status_code, 200)
        self.assertIn("never", playbook.json())
        dumped = json.dumps(playbook.json())
        self.assertNotIn("test-music-key-not-live", dumped)
        with social._LOCK:
            state = social._load()
            state["tracks"]["abc123xxxxx"] = {
                "id": "abc123xxxxx",
                "title": "FE!N",
                "artist": "Travis Scott",
                "request_count": 0,
                "reasons": [],
                "path": str(self.root / "Music" / "library" / "abc123xxxxx.mp3"),
            }
            social._save(state)
        out = self.client.post(
            "/api/marketing/v1/music/request",
            headers=headers,
            json={"query": "FE!N", "reason": "x_post", "reason_detail": "launch teaser"},
        )
        self.assertEqual(out.status_code, 200)
        body = out.json()
        self.assertTrue(body["cached"])
        self.assertEqual(body["track"]["request_count"], 1)
        self.assertIn("player_url", body["track"])

    def test_post_checkin_weekly_and_cross_platform(self) -> None:
        headers = {"Authorization": "Bearer test-music-key-not-live"}
        with social._LOCK:
            state = social._load()
            state["tracks"]["song1xxxxxx"] = {"id": "song1xxxxxx", "title": "FE!N", "artist": "Travis Scott", "request_count": 1, "reasons": []}
            social._save(state)
        a = self.client.post(
            "/api/marketing/v1/posts",
            headers=headers,
            json={
                "track_id": "song1xxxxxx",
                "platform": "x",
                "post_url": "https://x.com/render3d/status/1",
                "same_video_group": "launch-teaser",
            },
        )
        b = self.client.post(
            "/api/marketing/v1/posts",
            headers=headers,
            json={
                "track_id": "song1xxxxxx",
                "platform": "instagram",
                "post_url": "https://instagram.com/p/abc",
                "same_video_group": "launch-teaser",
            },
        )
        self.assertEqual(a.status_code, 200)
        self.assertEqual(b.status_code, 200)
        pid = a.json()["post"]["id"]
        chk = self.client.post(
            f"/api/marketing/v1/posts/{pid}/checkin",
            headers=headers,
            json={
                "impressions": 12000,
                "likes": 40,
                "comments": [{"text": "this slaps"}],
                "why_good_or_bad": "hook in the first line",
                "sentiment": "positive",
                "viral_from": "positive",
            },
        )
        self.assertEqual(chk.status_code, 200)
        ig = b.json()["post"]["id"]
        self.client.post(
            f"/api/marketing/v1/posts/{ig}/checkin",
            headers=headers,
            json={"impressions": 900, "likes": 4, "sentiment": "mixed", "viral_from": "none", "why_good_or_bad": "no question at the end"},
        )
        week = self.client.post(
            "/api/marketing/v1/reports/weekly",
            headers=headers,
            json={"week_of": "2026-09-08", "summary": "X outperformed IG", "recommendations": "Ask a question on X-style posts on IG too"},
        )
        self.assertEqual(week.status_code, 200)
        dash = social.dashboard_payload()
        self.assertGreaterEqual(len(dash["cross"]), 1)
        self.assertEqual(dash["cross"][0]["winner_platform"], "x")
        self.assertEqual(dash["cross"][0]["loser_platform"], "instagram")
        self.assertIn("question", dash["cross"][0]["advice"].lower())


if __name__ == "__main__":
    unittest.main()
