from __future__ import annotations

import tempfile
from pathlib import Path
from unittest.mock import patch

from backend.database import init_db
from backend.services import marketplace_hub_client as hub


def test_public_project_hub_caps_and_preserves_admin_promotion() -> None:
    with tempfile.TemporaryDirectory() as tmp, patch("backend.database.DB_PATH", Path(tmp) / "hub.db"):
        init_db()
        for index in range(30):
            hub.upsert_hub_public_project(
                "instance-a",
                {"id": f"project-{index}", "name": f"Project {index}",
                 "updated_at": f"2026-10-07T20:{index:02d}:00+00:00"},
            )
        promoted_id = "instance-a:project-0"
        hub.set_hub_public_project_promotion(promoted_id, pinned=True, marketplace=True)
        hub.upsert_hub_public_project("instance-a", {"id": "project-0", "name": "Updated"})

        rows = hub.list_hub_public_projects(limit=25)
        assert len(rows) == 25
        assert rows[0]["id"] == promoted_id
        assert rows[0]["name"] == "Updated"
        assert rows[0]["public_pinned"] is True
        assert rows[0]["marketplace_promoted"] is True


def test_origin_instance_pin_never_becomes_a_cross_instance_pin() -> None:
    with tempfile.TemporaryDirectory() as tmp, patch("backend.database.DB_PATH", Path(tmp) / "hub.db"):
        init_db()
        hub.upsert_hub_public_project(
            "instance-a",
            {"id": "local-featured", "name": "Locally featured", "public_pinned": True,
             "updated_at": "2026-10-08T04:30:00+00:00"},
        )
        rows = hub.list_hub_public_projects(limit=25)
        assert len(rows) == 1
        assert rows[0]["public_pinned"] is False
        assert rows[0]["origin_project_id"] == "local-featured"
