from __future__ import annotations

import json
from pathlib import Path

from backend.services import agent_knowledge_lake as lake


def test_layout_and_ingest(tmp_path, monkeypatch):
    monkeypatch.setattr(lake.settings, "data_dir", str(tmp_path / "data"))
    monkeypatch.setattr(lake, "ROOT_DIR", tmp_path)
    monkeypatch.setattr(lake, "sandbox_root", lambda: tmp_path / "sandbox-kb")
    monkeypatch.setattr(lake, "detect_cold_root", lambda: {"ok": False, "mounted": False, "path": None})
    monkeypatch.setattr(lake, "cold_root", lambda: None)

    st = lake.status()
    assert st["ok"] is True
    assert st["need_8tb"] is True
    assert st["token"] == "kb1"

    hit = lake.ingest_score({
        "log_id": "da6e44bf-004",
        "agent_id": "astra",
        "score": 64,
        "label": "partial",
        "beneficial": True,
        "notes": "CAD bot diagnosis helpful",
    })
    assert hit["ok"] is True
    assert hit["record"]["score"] == 64
    assert hit["storage"]["mounted"] is False

    rec = lake.ingest_receipt({
        "receipt_id": "RCPT-TEST",
        "author": "cursor-engineer",
        "log_id": "da6e44bf-004",
        "summary": "workshop receipt",
        "feature_ids": ["viewport.layouts"],
        "at": "2026-09-18T05:12:00.000Z",
    }, extra={"score": 70, "label": "pending"})
    assert rec["record"]["receipt_id"] == "RCPT-TEST"

    by_feature = lake.search(feature_id="viewport.layouts")
    assert by_feature["n"] == 1
    assert by_feature["rows"][0]["receipt_id"] == "RCPT-TEST"

    synced = lake.sync_feature_map({
        "updated_at": "2026-09-23T09:00:00Z",
        "features": [{
            "id": "viewport.layouts", "name": "Viewport layouts", "lock": "on", "criticality": "high",
            "paths": ["frontend/studio/"], "receipt_ids": ["RCPT-TEST"], "checks": [{"id": "layout"}],
        }],
    })
    assert synced["features_indexed"] == 1
    contracts = lake.search_features(query="frontend/studio")
    assert contracts["n"] == 1
    assert contracts["rows"][0]["feature_id"] == "viewport.layouts"

    found = lake.search(query="CAD bot")
    assert found["n"] >= 1
    assert any(row["agent_id"] == "astra" for row in found["rows"])


def test_cold_root_from_env(tmp_path, monkeypatch):
    cold = tmp_path / "8TB" / "Render-Knowledge"
    cold.mkdir(parents=True)
    monkeypatch.setenv("RENDER_KB_ROOT", str(cold))
    hit = lake.detect_cold_root()
    assert hit["ok"] is True
    assert hit["source"] == "env"
