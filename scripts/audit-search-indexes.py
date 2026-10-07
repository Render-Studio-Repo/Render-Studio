#!/usr/bin/env python3
"""Fail when a known vector search loses its database or request-level index."""

from __future__ import annotations

import sqlite3
import json
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def require(text: str, needle: str, label: str) -> None:
    if needle not in text:
        raise SystemExit(f"missing {label}: {needle}")


def main() -> None:
    registry = json.loads((ROOT / "ai-context/search-indexes.json").read_text(encoding="utf-8"))
    ids = {row.get("id") for row in registry.get("systems", [])}
    if ids != {"grok-drive-production", "prompt-vector-lab"}:
        raise SystemExit(f"unexpected vector-search registry: {sorted(ids)}")
    migration = (ROOT / "integrations/supabase/migrations/015_grok_drive_vector_index.sql").read_text(encoding="utf-8")
    service = (ROOT / "backend/services/grok_drive_index_service.py").read_text(encoding="utf-8")
    require(migration, "USING hnsw (embedding vector_cosine_ops)", "pgvector cosine HNSW index")
    require(service, "@lru_cache(maxsize=256)", "bounded query embedding cache")

    from scripts.prompt_vector_lab import PromptIndex

    db_path = ROOT / "data/search-index-audit.sqlite3"
    try:
        PromptIndex(db_path)
        with sqlite3.connect(db_path) as db:
            indexes = {row[1] for row in db.execute("PRAGMA index_list('chunks')")}
            plan = db.execute(
                "EXPLAIN QUERY PLAN SELECT * FROM chunks WHERE provider=? AND document_id=?",
                ("local_hash", "audit"),
            ).fetchall()
        if "chunk_provider_doc" not in indexes:
            raise SystemExit("missing local vector provider/document index")
        if not any("chunk_provider_doc" in str(row) for row in plan):
            raise SystemExit("local vector lookup does not use chunk_provider_doc")
    finally:
        db_path.unlink(missing_ok=True)
    print("SEARCH_INDEX_AUDIT systems=2 production_hnsw=ok query_cache=ok local_filter_plan=ok")


if __name__ == "__main__":
    main()
