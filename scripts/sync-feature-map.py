#!/usr/bin/env python3
"""Synchronize locked feature contracts and local receipt files into the knowledge catalog."""

from __future__ import annotations

import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.services import agent_knowledge_lake as lake  # noqa: E402


def main() -> None:
    feature_map = json.loads((ROOT / "ai-context" / "feature-map.json").read_text(encoding="utf-8"))
    result = lake.sync_feature_map(feature_map)
    ingested = 0
    skipped = 0
    for path in sorted((ROOT / "ai-context" / "receipts").glob("*.json")):
        receipt = json.loads(path.read_text(encoding="utf-8"))
        record_id = str(receipt.get("revision_id") or receipt.get("receipt_id") or "")
        with lake._conn() as conn:
            exists = conn.execute("SELECT 1 FROM records WHERE id = ?", (record_id,)).fetchone()
        if exists:
            skipped += 1
            continue
        lake.ingest_receipt(receipt, {"id": record_id, "label": receipt.get("status")})
        ingested += 1
    print(json.dumps({**result, "receipts_ingested": ingested, "receipts_unchanged": skipped}))


if __name__ == "__main__":
    main()
