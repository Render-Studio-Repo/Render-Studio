"""10-minute team status report + debugger pulse."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import team_status_service as ts


class TeamStatusTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.patches = [
            patch.object(ts, "STORE", root),
            patch.object(ts, "STATUS_JSON", root / "team-status.json"),
            patch.object(ts, "STATUS_MD", root / "TEAM-STATUS.md"),
            patch.object(ts, "HISTORY", root / "hist.jsonl"),
            patch.object(ts, "PULSE_JSON", root / "team-pulse.json"),
            patch.object(ts, "send_pulse_mail", return_value={"ok": True, "to": [ts.SAM_EMAIL]}),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self) -> None:
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def test_report_has_three_goals_and_scores(self) -> None:
        report = ts.build_report(tick=1)
        self.assertEqual(len(report["goals"]), 3)
        self.assertIn("team_score", report)
        self.assertTrue(any(a["agent"] == "api-builder" for a in report["agents"]))
        self.assertIn("Ask Cursor", report["goals"][0])

    def test_publish_writes_json(self) -> None:
        out = ts.publish(force_email=True)
        self.assertTrue(out["ok"])
        self.assertTrue(ts.STATUS_JSON.is_file())
        self.assertIn("Render Studio team pulse", ts.STATUS_MD.read_text(encoding="utf-8"))
        self.assertIn("bender", out)
        self.assertIn("cursor_delta", out)

    def test_bender_is_lowest_rick_is_highest(self) -> None:
        agents = [
            {"agent": "project-manager", "score": 80},
            {"agent": "clip-bot", "score": 40},
            {"agent": "cursor-engineer", "score": 70},
            {"agent": "vibe-sales", "score": 95},
            {"agent": "analytics", "score": 40},
        ]
        bender, rick = ts.pick_bender_rick(agents)
        self.assertEqual(bender["agent"], "clip-bot")
        self.assertEqual(rick["agent"], "vibe-sales")

    def test_bender_rick_tie_keeps_first_listed(self) -> None:
        agents = [
            {"agent": "alpha", "score": 10},
            {"agent": "beta", "score": 10},
            {"agent": "gamma", "score": 90},
            {"agent": "delta", "score": 90},
        ]
        bender, rick = ts.pick_bender_rick(agents)
        self.assertEqual(bender["agent"], "alpha")
        self.assertEqual(rick["agent"], "gamma")

    def test_cursor_score_uses_cursor_engineer(self) -> None:
        agents = [
            {"agent": "project-manager", "score": 95},
            {"agent": "cursor-engineer", "score": 71},
        ]
        self.assertEqual(ts.cursor_score_from_agents(agents), 71)

    def test_scoring_deltas_up_and_down(self) -> None:
        agents = [
            {"agent": "cursor-engineer", "score": 88, "label": "exceeded"},
            {"agent": "api-builder", "score": 40, "label": "partial"},
            {"agent": "vibe-rnd", "score": 70, "label": "achieved"},
        ]
        prev = {"cursor_score": 80, "team_score": 70}
        report = {"tick": 2, "ts": "2026-09-16T17:40:00-05:00", "agents": agents, "team_score": 66}
        out = ts.apply_pulse(report, prev, {"bender_counts": {}, "rick_counts": {}}, increment=True)
        self.assertEqual(out["cursor_score"], 88)
        self.assertEqual(out["cursor_delta"], 8)
        self.assertEqual(out["cursor_delta_dir"], "UP")
        self.assertEqual(out["team_delta"], -4)
        self.assertEqual(out["team_delta_dir"], "DOWN")
        self.assertEqual(out["bender"], "api-builder")
        self.assertEqual(out["rick"], "cursor-engineer")

    def test_running_bender_rick_counts_and_leaders(self) -> None:
        agents = [
            {"agent": "cursor-engineer", "score": 60, "label": "achieved"},
            {"agent": "clip-bot", "score": 20, "label": "missed"},
            {"agent": "vibe-sales", "score": 99, "label": "exceeded"},
        ]
        leaders = {"bender_counts": {"clip-bot": 2, "api-builder": 1}, "rick_counts": {"vibe-sales": 1, "analytics": 3}}
        first = ts.apply_pulse(
            {"tick": 3, "ts": "t3", "agents": agents, "team_score": 60},
            {"cursor_score": 60, "team_score": 60},
            leaders,
            increment=True,
        )
        self.assertEqual(first["bender_counts"]["clip-bot"], 3)
        self.assertEqual(first["rick_counts"]["vibe-sales"], 2)
        self.assertEqual(first["most_likely_bender"], "clip-bot")
        self.assertEqual(first["most_likely_rick"], "analytics")
        self.assertEqual(first["cursor_delta"], 0)
        self.assertEqual(first["cursor_delta_dir"], "FLAT")
        second = ts.apply_pulse(
            {"tick": 4, "ts": "t4", "agents": agents, "team_score": 60},
            {"cursor_score": 60, "team_score": 60},
            {"bender_counts": first["bender_counts"], "rick_counts": first["rick_counts"]},
            increment=True,
        )
        self.assertEqual(second["bender_counts"]["clip-bot"], 4)
        self.assertEqual(second["most_likely_bender"], "clip-bot")
        self.assertEqual(second["most_likely_bender_count"], 4)

    def test_publish_persists_pulse_history(self) -> None:
        first = ts.publish(force_email=True)
        second = ts.publish(force_email=True)
        self.assertTrue(ts.PULSE_JSON.is_file())
        leaders = json.loads(ts.PULSE_JSON.read_text(encoding="utf-8"))
        self.assertGreaterEqual(sum(leaders["bender_counts"].values()), 2)
        self.assertGreaterEqual(sum(leaders["rick_counts"].values()), 2)
        lines = [json.loads(line) for line in ts.HISTORY.read_text(encoding="utf-8").splitlines() if line.strip()]
        self.assertGreaterEqual(len(lines), 2)
        self.assertIn("bender", lines[-1])
        self.assertIn("agents", lines[-1])
        self.assertIn("cursor_delta", lines[-1])
        self.assertEqual(second["tick"], first["tick"] + 1)
        latest = ts.latest()
        self.assertEqual(latest["bender"], second["bender"])
        self.assertTrue(latest["pulse_history"])

    def test_http_get_includes_pulse_fields(self) -> None:
        ts.publish(force_email=True)
        code, body, ctype = ts.http_get("/mcp/team-chat")
        self.assertEqual(code, 200)
        self.assertIn("json", ctype)
        data = json.loads(body.decode())
        for key in (
            "cursor_score",
            "team_score",
            "cursor_delta",
            "team_delta",
            "bender",
            "rick",
            "bender_counts",
            "rick_counts",
            "most_likely_bender",
            "most_likely_rick",
            "pulse_history",
        ):
            self.assertIn(key, data)
        hist_code, hist_body, _ = ts.http_get("/mcp/team-chat/history")
        self.assertEqual(hist_code, 200)
        hist = json.loads(hist_body.decode())
        self.assertTrue(hist["pulses"])
        pulse_code, _, _ = ts.http_get("/mcp/team-chat/pulse")
        self.assertEqual(pulse_code, 200)

    def test_founder_can_post_group_chat(self) -> None:
        chat = Path(self.tmp.name) / "group-chat.jsonl"
        with patch.object(ts, "GROUP_CHAT", chat), patch.object(ts, "_SAM_POST_LAST", 0):
            out = ts.post_founder_chat("hello crew")
            self.assertEqual(out["posted"]["agent"], "sam")
            self.assertIn("hello crew", chat.read_text(encoding="utf-8"))
            read = ts.read_group_chat()
            self.assertEqual(read["messages"][-1]["text"], "hello crew")
