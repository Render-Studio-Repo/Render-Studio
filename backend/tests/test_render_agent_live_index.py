"""Render Agent live Updates + shortcuts index (no repo crawl)."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import render_agent_live_index as live


ROOT = Path(__file__).resolve().parents[2]
SERVICE_SRC = (ROOT / "backend" / "services" / "render_agent_live_index.py").read_text(encoding="utf-8")
APP_JS = (ROOT / "frontend" / "studio" / "app.js").read_text(encoding="utf-8")
CANVAS_JS = (ROOT / "frontend" / "viewport" / "canvas-mode.js").read_text(encoding="utf-8")
SKETCH_JS = (ROOT / "frontend" / "components" / "sketch-editor.js").read_text(encoding="utf-8")
CLIP_JS = (ROOT / "frontend" / "viewport" / "video-timeline-editor.js").read_text(encoding="utf-8")


class RenderAgentLiveIndexTests(unittest.TestCase):
    def setUp(self) -> None:
        live.clear_cache()

    def tearDown(self) -> None:
        live.clear_cache()

    def test_service_does_not_crawl_the_repo(self) -> None:
        self.assertNotIn("rglob", SERVICE_SRC)
        self.assertNotIn("os.walk", SERVICE_SRC)
        self.assertNotIn("glob.glob", SERVICE_SRC)
        self.assertIn("shipped.json", SERVICE_SRC)
        self.assertIn("shortcuts.json", SERVICE_SRC)

    def test_load_index_reads_published_updates_and_shortcuts(self) -> None:
        payload = live.load_index()
        ids = {row["id"] for row in payload["updates"]}
        self.assertIn("clip-video-editor", ids)
        self.assertTrue(any("Imagine" in (row.get("title") or "") for row in payload["updates"]))
        titles = " ".join(row["title"] for row in payload["updates"][:12])
        self.assertTrue(titles)
        ctx = {c["id"]: c for c in payload["shortcuts"]}
        self.assertIn("viewport", ctx)
        combos = {row["combo"]: row["action"] for row in ctx["viewport"]["keys"]}
        self.assertIn("T", combos)
        self.assertIn("transparent", combos["T"].lower())
        self.assertIn("M", combos)
        canvas = {row["combo"]: row["action"] for row in ctx["canvas"]["keys"]}
        self.assertEqual(canvas["T"].lower().split()[0], "text")
        clip = {row["combo"]: row["action"] for row in ctx["clip-editor"]["keys"]}
        self.assertIn("Space", clip)

    def test_whats_new_and_shortcut_questions_use_the_live_index(self) -> None:
        new_block = live.context_block("What's new in Render Studio?")
        self.assertIn("Live product index JSON", new_block)
        self.assertIn("Clip / video editor", new_block)
        self.assertIn("Saved viewport split layouts", new_block)
        self.assertRegex(new_block, r"2026-09-1[0-9]")
        keys = live.context_block("What's the shortcut for transparent?")
        self.assertIn('"combo":"T"', keys)
        self.assertIn("Transparent", keys)
        self.assertNotIn("Pad", keys)
        self.assertNotIn("Spline", keys)
        self.assertNotIn('"combo":"S"', keys)
        self.assertIn("Transparent viewport tool", keys)
        clip = live.context_block("What's the shortcut for play in the clip editor?")
        self.assertIn("Space", clip)
        canvas = live.context_block("Canvas shortcut for text")
        self.assertIn('"combo":"T"', canvas)
        idle = live.context_block("hello there")
        self.assertEqual(idle, "")

    def test_viewport_json_keys_match_real_handlers(self) -> None:
        self.assertIn("function shouldHandleTransparentShortcut", APP_JS)
        self.assertIn('key !== "t"', APP_JS)
        self.assertIn("activateTransparentShortcut", APP_JS)
        self.assertIn("activateObjectTransformShortcut", APP_JS)
        self.assertIn('if (key === "g" || key === "m") openTransformMode("translate")', APP_JS)
        self.assertIn("isCanvasUndoShortcut", CANVAS_JS)
        self.assertIn('t: "text"', CANVAS_JS)
        self.assertIn("SKETCH_SHORTCUTS", SKETCH_JS)
        self.assertIn('l: "line"', SKETCH_JS)
        self.assertIn('e.code === "Space"', CLIP_JS)

    def test_cache_is_mtime_keyed_and_cms_posts_merge(self) -> None:
        first = live.load_index()
        second = live.load_index()
        self.assertIs(first, second)
        with tempfile.TemporaryDirectory() as tmp:
            pages = Path(tmp) / "site_pages.json"
            pages.write_text(
                '{"updates":{"posts":[{"id":"live-index-test","date":"2026-09-15",'
                '"title":"Live index CMS post","summary":"From admin Add update.",'
                '"published":true}]}}',
                encoding="utf-8",
            )
            with patch("backend.config.settings.data_dir", tmp), patch(
                "backend.services.site_pages_service.settings.data_dir", tmp
            ):
                live.clear_cache()
                payload = live.load_index()
            ids = {row["id"] for row in payload["updates"]}
            self.assertIn("live-index-test", ids)

    def test_write_updates_index_is_compact(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "updates-index.json"
            with patch.object(live, "UPDATES_INDEX", path):
                written = live.write_updates_index(
                    [
                        {
                            "id": "clip-video-editor",
                            "date": "2026-09-14",
                            "kind": "tool",
                            "title": "Clip / video editor tab",
                            "summary": "Viewport recordings open a built-in clip editor.",
                            "href": "/",
                            "keywords": ["clip"],
                        }
                    ]
                )
            self.assertEqual(written, path)
            data = path.read_text(encoding="utf-8")
            self.assertIn("clip-video-editor", data)
            self.assertLess(path.stat().st_size, 4000)


if __name__ == "__main__":
    unittest.main()
