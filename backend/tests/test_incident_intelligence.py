"""Incident evidence boundaries, extensible fields, and alert lifecycle."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import Body, Depends, FastAPI, Request

from backend.services import incident_intelligence_service as svc


class IncidentIntelligenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.patches = [
            patch.object(svc, "ROOT_DIR", root),
            patch.object(svc, "DB_PATH", root / "incident.sqlite3"),
            patch.object(svc, "LOG_ROOT", root / "ai-context" / "debugger" / "incident-intelligence"),
        ]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.temp.cleanup()

    def test_golden_boundaries_alert_and_recovery(self):
        good = svc.record_snapshot({"label": "VR works", "golden": True, "kernel": "old", "features": {"vr.controllers.trigger": "ok"}})
        bad = svc.record_snapshot({"label": "VR trigger lost", "kernel": "new", "features": {"vr.controllers.trigger": "broken"}})
        result = svc.compare("vr.controllers.trigger")
        self.assertEqual(result["last_working_snapshot"]["id"], good["id"])
        self.assertEqual(result["first_failing_snapshot"]["id"], bad["id"])
        self.assertEqual(result["cause_hint"], "kernel-or-runtime-change")
        self.assertIn("CURSOR_FIX", result["cursor_packet"])
        self.assertIn(result["first_failure"]["log_path"], result["cursor_packet"])
        overview = svc.overview()
        self.assertTrue((svc.ROOT_DIR / overview["weekly"]["report_path"]).is_file())
        alert = next(row for row in overview["alerts"] if row["feature"] == "vr.controllers.trigger")
        self.assertEqual(alert["priority"], "high")
        self.assertTrue(svc.read_log(alert["log_id"]))
        svc.system_smoke()
        self.assertTrue(any(row["feature"] == "vr.controllers.trigger" for row in svc.overview()["alerts"]))
        svc.record_event({"feature": "vr.controllers.trigger", "status": "ok", "source": "device-smoke"})
        self.assertFalse(any(row["feature"] == "vr.controllers.trigger" for row in svc.overview()["alerts"]))

    def test_registered_fields_and_bounded_query(self):
        svc.register_field({"name": "renderer.kernel", "type": "string", "description": "Rendering kernel"})
        event = svc.record_event({"feature": "viewport.models", "status": "missing", "fields": {"renderer.kernel": "metal"}})
        self.assertEqual(svc.query_events({"renderer.kernel": "metal"})[0]["id"], event["id"])
        svc.register_field({"name": "network.rtt_ms", "type": "number", "description": "Network round trip"})
        svc.record_event({"feature": "network.latency", "status": "degraded", "fields": {"network.rtt_ms": 180}})
        self.assertEqual(len(svc.query_events({"network.rtt_ms": {"gt": 100}})), 1)
        with self.assertRaises(ValueError):
            svc.query_events({"unregistered": "value"})
        with self.assertRaises(ValueError):
            svc.register_field({"name": "x'); DROP TABLE events;--", "type": "string"})
        with self.assertRaises(ValueError):
            svc.record_event({"feature": "viewport.models", "status": "good"})

    def test_findings_keep_verification_separate(self):
        finding = svc.record_finding({"feature": "viewport.models", "hypothesis": "Rigging hid models", "steps": ["Compare snapshots"], "outcome": "unverified"})
        self.assertEqual(finding["outcome"], "unverified")
        self.assertEqual(svc.overview()["findings"][0]["id"], finding["id"])

    def test_webgl_context_lost_stays_off_viewport_boot(self):
        svc.record_event({"feature": "viewport.boot", "status": "ok", "kind": "client-smoke", "note": "Renderer initialized", "source": "studio-webgl"})
        svc.record_event({"feature": "webgl.context", "status": "ok", "kind": "client-smoke", "note": "WebGL context restored", "source": "studio-webgl"})
        svc.record_event({"feature": "webgl.context", "status": "broken", "kind": "client-smoke", "note": "WebGL context lost", "source": "studio-webgl"})
        webgl = svc.compare("webgl.context")
        boot = svc.compare("viewport.boot")
        self.assertEqual(webgl["last_working"]["feature"], "webgl.context")
        self.assertEqual(webgl["last_working"]["status"], "ok")
        self.assertEqual(webgl["first_failure"]["feature"], "webgl.context")
        self.assertEqual(webgl["first_failure"]["status"], "broken")
        self.assertEqual(webgl["first_failure"]["note"], "WebGL context lost")
        self.assertNotEqual(webgl["first_failure"]["feature"], "viewport.boot")
        self.assertIsNone(boot["first_failure"])
        boot_ok = svc.latest("viewport.boot")
        self.assertEqual(boot_ok["status"], "ok")
        self.assertEqual(boot_ok["feature"], "viewport.boot")

    def test_checklist_and_chat_search(self):
        listed = svc.record_checklist({
            "prompt_id": "d9c98119-010",
            "features": {"viewport.boot": "ok", "viewport.models": "missing", "webgl.context": "broken"},
            "note": "Rigging hid models",
            "cause_layer": "code",
        })
        self.assertEqual(listed["counts"]["ok"], 1)
        self.assertEqual(listed["counts"]["missing"], 1)
        alert = next(row for row in svc.overview()["alerts"] if row["feature"] == "viewport.models")
        self.assertEqual(alert["priority"], "high")
        self.assertIn("CURSOR_FIX", alert["cursor_packet"])
        fake = [
            {"log_id": "d9c98119-009", "prompt": "add the rigging feature", "result": "continued", "notes": "", "categories": ["viewport"]},
            {"log_id": "d9c98119-010", "prompt": "models disappeared and webgl is black", "result": "broke", "blamed_log_id": "d9c98119-009", "notes": "duplicates", "categories": ["webgl"]},
        ]
        with patch("backend.services.prompt_trace_service.all_prompts", return_value=fake):
            hits = svc.search_chat_logs("webgl")
        self.assertEqual(hits["hits"][0]["log_id"], "d9c98119-010")
        self.assertEqual(hits["hits"][0]["blamed_log_id"], "d9c98119-009")

    def test_local_pdf_export_vote_and_grok_audit(self):
        from backend.services import incident_export_service as exp
        svc.record_snapshot({"label": "models ok", "golden": True, "features": {"viewport.models": "ok"}})
        svc.record_event({"feature": "viewport.models", "status": "missing", "note": "rigging hid models"})
        exported = exp.export_packet({"destination": "local", "feature": "viewport.models"})
        folder = svc.ROOT_DIR / exported["folder_path"]
        txt = (svc.ROOT_DIR / exported["txt_path"]).read_text(encoding="utf-8")
        self.assertTrue((folder / f"{exported['traceback_id']}.pdf").is_file())
        self.assertIn("Central", txt)
        self.assertIn("traceback_id:", txt)
        self.assertIn(exported["traceback_id"], txt)
        self.assertTrue(exported["share_url"].endswith(exported["share_token"]))
        voted = exp.vote_export(exported["id"], "up")
        self.assertEqual(voted["sam_claim"], "ok")
        self.assertTrue(exp.pending_audits())
        inbox = exp.grok_inbox()
        self.assertEqual(inbox["inbox"][0]["kind"], "audit-sam-ok")
        audited = exp.record_audit({"export_id": exported["id"], "verified": "broken", "grok_claim": "broken"})
        self.assertFalse(audited["sam_correct"])
        chart = exp.accuracy_chart()
        self.assertGreaterEqual(chart["bot"]["correct"], 1)
        shared = exp.public_share(exported["share_token"])
        self.assertEqual(shared["traceback_id"], exported["traceback_id"])
        html = exp.share_html(shared)
        self.assertIn("Incident packet", html)

    def test_thumbs_down_records_user_damage_and_ingests_liabilities(self):
        from backend.services import debugger_analytics_service as das
        from backend.services import debugger_swarm_service as dss
        from backend.services import incident_export_service as exp

        svc.record_event({"feature": "viewport.models", "status": "missing", "note": "thumb test"})
        exported = exp.export_packet({"destination": "local", "feature": "viewport.models"})
        dash = Path(self.temp.name)
        with patch.object(das, "ROOT_DIR", dash), patch.object(das, "DB_PATH", dash / "debugger.sqlite3"):
            voted = exp.vote_export(exported["id"], "down")
            credits = [r for r in dss.list_credit(limit=40) if r.get("category") == "liabilities"]
            again = dss.ingest_thumb_down_liability({"event_id": svc.latest("user.damage")["id"], "export_id": exported["id"]})
        self.assertEqual(voted["vote"], "down")
        self.assertEqual(voted["sam_claim"], "broken")
        damage = svc.latest("user.damage")
        self.assertIsNotNone(damage)
        self.assertEqual(damage["source"], "thumbs-down")
        self.assertEqual(damage["status"], "broken")
        self.assertEqual(len(credits), 1)
        self.assertTrue(again.get("skipped"))
        self.assertFalse(again.get("invented"))

    def test_macbook_export_without_ssh_records_error(self):
        from backend.services import incident_export_service as exp
        svc.record_event({"feature": "vr.controllers.trigger", "status": "broken"})
        with patch.object(exp.settings, "incident_export_ssh", ""):
            exported = exp.export_packet({"destination": "macbook", "feature": "vr.controllers.trigger"})
        self.assertFalse(exported["fields"].get("scp_ok"))
        self.assertIn("INCIDENT_EXPORT_SSH", exported["fields"].get("scp_error") or exported["note"])


class IncidentStampAuthTests(unittest.TestCase):
    """Logged-in user or harness can stamp client-smoke features. Mutations stay admin."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        from backend.auth import get_current_user_optional
        from backend.config import settings
        from backend.routers import debugger_analytics as dar
        from backend.routers.debugger_analytics import require_incident_stamp
        from fastapi.testclient import TestClient

        self.patches = [
            patch.object(svc, "ROOT_DIR", root),
            patch.object(svc, "DB_PATH", root / "incident.sqlite3"),
            patch.object(svc, "LOG_ROOT", root / "ii-logs"),
            patch.object(settings, "prompt_trace_api_key", "test-harness-loop22"),
        ]
        for item in self.patches:
            item.start()
        self.session_user = None
        app = FastAPI()
        app.include_router(dar.router)

        def optional_user():
            return self.session_user

        app.dependency_overrides[get_current_user_optional] = optional_user

        @app.post("/api/ops/incidents/events")
        def stamp(
            request: Request,
            body: dict = Body(...),
            user: dict | None = Depends(get_current_user_optional),
        ):
            require_incident_stamp(request, user, str((body or {}).get("feature") or ""))
            return svc.record_event(body)

        self.client = TestClient(app)
        self.harness = {"Authorization": "Bearer test-harness-loop22"}

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.temp.cleanup()

    def test_client_stamp_allowlist(self):
        from backend.routers.debugger_analytics import client_stamp_allowed

        self.assertTrue(client_stamp_allowed("webgl.context"))
        self.assertTrue(client_stamp_allowed("network.timeout"))
        self.assertTrue(client_stamp_allowed("vr.controllers"))
        self.assertTrue(client_stamp_allowed("memory.leak"))
        self.assertTrue(client_stamp_allowed("system.ram"))
        self.assertFalse(client_stamp_allowed("prompt.run"))
        self.assertTrue(client_stamp_allowed("prompt.run", super_admin=True))

    def test_unauth_stamp_401(self):
        res = self.client.post("/api/ops/incidents/events", json={"feature": "webgl.context", "status": "broken"})
        self.assertEqual(res.status_code, 401)

    def test_harness_can_stamp_client_smoke(self):
        res = self.client.post(
            "/api/ops/incidents/events",
            headers=self.harness,
            json={"feature": "webgl.context", "status": "broken", "kind": "client-smoke", "source": "test"},
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json().get("feature"), "webgl.context")

    def test_logged_in_user_can_stamp_network(self):
        self.session_user = {"id": "studio-user", "email": "user@example.com"}
        res = self.client.post(
            "/api/ops/incidents/events",
            json={"feature": "network.timeout", "status": "broken", "kind": "client-smoke", "source": "test"},
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json().get("feature"), "network.timeout")

    def test_harness_cannot_stamp_kernel_feature(self):
        res = self.client.post(
            "/api/ops/incidents/events",
            headers=self.harness,
            json={"feature": "prompt.run", "status": "broken"},
        )
        self.assertEqual(res.status_code, 403)

    def test_harness_cannot_put_league_report(self):
        res = self.client.put(
            "/api/ops/debugger-analytics/league/report/rpt_noleak",
            headers=self.harness,
            json={"action": "noted"},
        )
        self.assertIn(res.status_code, (401, 403))


if __name__ == "__main__":
    unittest.main()
