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


class InstanceNetworkRegistryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.tmp.name)
        self.patch = patch.object(registry.settings, "data_dir", str(self.data_dir))
        self.patch.start()
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


if __name__ == "__main__":
    unittest.main()
