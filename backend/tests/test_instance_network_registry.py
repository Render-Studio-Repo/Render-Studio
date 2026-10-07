from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.auth import get_current_user_optional
from backend.routers.instance_network import router
from backend.services import instance_network_registry as registry
from backend.services import instance_network_client as network


class InstanceNetworkRegistryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.tmp.name)
        self.patch = patch.object(registry.settings, "data_dir", str(self.data_dir))
        self.patch.start()
        self.hub_patch = patch.object(network, "is_official_hub", return_value=True)
        self.hub_patch.start()
        app = FastAPI()
        app.include_router(router)
        self.app = app
        self.client = TestClient(app)
        self.identity = {
            "instance_id": "instance-test-001",
            "instance_secret": "correct-horse-battery-staple-001",
            "instance_name": "Friend's workshop",
            "user_count": 3,
            "project_count": 7,
            "storage_bytes": 4096,
            "git_sha": "abc123",
            "runtime": "python-3.13",
            "platform": "linux",
        }

    def tearDown(self) -> None:
        self.hub_patch.stop()
        self.patch.stop()
        self.tmp.cleanup()

    def _admin(self) -> None:
        self.app.dependency_overrides[get_current_user_optional] = lambda: {
            "id": "admin-1", "email": "admin@example.test", "role": "admin"
        }

    def test_registration_stores_hash_and_heartbeat_requires_matching_secret(self) -> None:
        response = self.client.post("/api/instance-network/v1/register", json=self.identity)
        self.assertEqual(response.status_code, 200)

        with sqlite3.connect(self.data_dir / "instance_network.sqlite3") as conn:
            stored = conn.execute("SELECT secret_hash FROM instances").fetchone()[0]
            columns = {row[1] for row in conn.execute("PRAGMA table_info(instances)")}
        self.assertNotEqual(stored, self.identity["instance_secret"])
        self.assertNotIn("ip", columns)
        self.assertNotIn("hostname", columns)
        self.assertNotIn("user_id", columns)

        wrong = dict(self.identity, instance_secret="wrong-secret-that-is-long-enough")
        self.assertEqual(self.client.post("/api/instance-network/v1/heartbeat", json=wrong).status_code, 403)
        updated = dict(self.identity, project_count=8)
        self.assertEqual(self.client.post("/api/instance-network/v1/heartbeat", json=updated).status_code, 200)

    def test_unknown_heartbeat_requests_registration(self) -> None:
        response = self.client.post("/api/instance-network/v1/heartbeat", json=self.identity)
        self.assertEqual(response.status_code, 404)

    def test_submission_is_redacted_idempotent_and_visible_to_admin(self) -> None:
        self.client.post("/api/instance-network/v1/register", json=self.identity)
        report = {
            **self.identity,
            "kind": "issue",
            "subject": "Marketplace publish failed",
            "message": "Authorization: Bearer abc.def.ghi while publishing",
            "diagnostic": "token=top-secret-value",
            "severity": "high",
            "client_token": "same-report",
        }
        first = self.client.post("/api/instance-network/v1/submissions", json=report)
        second = self.client.post("/api/instance-network/v1/submissions", json=report)
        self.assertEqual(first.status_code, 200)
        self.assertTrue(second.json()["duplicate"])

        self.assertEqual(self.client.get("/api/admin/instance-network/overview").status_code, 403)
        self._admin()
        overview = self.client.get("/api/admin/instance-network/overview").json()
        self.assertEqual(overview["counts"]["instances"], 1)
        self.assertEqual(overview["counts"]["unread"], 1)
        self.assertEqual(len(overview["submissions"]), 1)
        blob = str(overview["submissions"])
        self.assertNotIn("abc.def.ghi", blob)
        self.assertNotIn("top-secret-value", blob)

        marked = self.client.post("/api/admin/instance-network/read", json={}).json()
        self.assertEqual(marked["updated"], 1)
        self.assertEqual(self.client.get("/api/admin/instance-network/overview").json()["counts"]["unread"], 0)

    def test_overview_search_returns_management_panel_shape(self) -> None:
        self.client.post("/api/instance-network/v1/register", json=self.identity)
        self.client.post("/api/instance-network/v1/register", json={
            **self.identity,
            "instance_id": "instance-test-002",
            "instance_secret": "another-correct-secret-value-002",
            "instance_name": "Second shop",
        })
        self._admin()
        data = self.client.get("/api/admin/instance-network/overview?q=friend").json()
        self.assertEqual(len(data["instances"]), 1)
        self.assertEqual(data["instances"][0]["instance_name"], "Friend's workshop")
        self.assertIn("status", data["instances"][0])
        self.assertEqual(set(data), {"ok", "privacy", "counts", "instances", "history", "submissions"})

    def test_instance_admin_can_send_separate_instance_bug(self) -> None:
        self._admin()
        with patch("backend.routers.instance_network.network.submit", return_value={"ok": True, "submission_id": "bug-1"}) as submit:
            response = self.client.post("/api/setup/instance-support", json={
                "kind": "issue",
                "subject": "Studio instance bug",
                "message": "Updates fail on this installation",
                "severity": "normal",
                "diagnostic": "",
            })
        self.assertEqual(response.status_code, 200)
        submit.assert_called_once()

    def test_non_hub_instance_cannot_open_central_management(self) -> None:
        self._admin()
        with patch.object(network, "is_official_hub", return_value=False):
            response = self.client.get("/api/admin/instance-network/overview")
        self.assertEqual(response.status_code, 403)

    def test_instance_admin_sees_only_current_instance_management(self) -> None:
        self._admin()
        with (
            patch.object(network, "is_official_hub", return_value=False),
            patch.object(network, "public_status", return_value={"instance_id": "instance-test-001", "instance_name": "Friend's workshop"}),
            patch.object(network, "metrics", return_value={"user_count": 2, "project_count": 4, "storage_bytes": 100}),
            patch("backend.routers.instance_network.feedback_service.summary", return_value={"unread_count": 1}),
        ):
            response = self.client.get("/api/setup/instance-management")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["scope"], "current_instance")
        self.assertEqual(data["instance"]["instance_id"], "instance-test-001")
        self.assertNotIn("instances", data)

    def test_submission_can_be_linked_to_github_issue_and_managed(self) -> None:
        self.client.post("/api/instance-network/v1/register", json=self.identity)
        report = self.client.post("/api/instance-network/v1/submissions", json={
            **self.identity,
            "kind": "suggestion",
            "subject": "Add a fixture browser",
            "message": "A fixture browser would help this workshop.",
            "client_token": "suggestion-1",
        }).json()
        self._admin()
        with patch("backend.routers.instance_network.github_issues_service.create_instance_report_issue", return_value={
            "ok": True, "number": 42, "html_url": "https://github.com/wprojects/Render-Studio/issues/42", "state": "open",
        }):
            linked = self.client.post(f"/api/admin/instance-network/submissions/{report['submission_id']}/github-issue")
        self.assertEqual(linked.status_code, 200)
        self.assertEqual(linked.json()["github_issue_number"], 42)
        with patch("backend.routers.instance_network.github_issues_service.update_issue_state", return_value={"ok": True, "number": 42, "state": "closed"}):
            changed = self.client.patch("/api/admin/instance-network/github/issues/42", json={"state": "closed"})
        self.assertEqual(changed.status_code, 200)
        overview = self.client.get("/api/admin/instance-network/overview").json()
        self.assertEqual(overview["submissions"][0]["github_issue_state"], "closed")


if __name__ == "__main__":
    unittest.main()
