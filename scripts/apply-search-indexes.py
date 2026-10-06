#!/usr/bin/env python3
"""Apply and verify the production Grok Drive vector index without ingesting data."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "integrations/supabase/migrations/015_grok_drive_vector_index.sql"
INDEX = "grok_drive_index_embedding_hnsw"


def query(sql: str):
    token = (os.environ.get("SUPABASE_ACCESS_TOKEN") or "").strip()
    host = urlparse((os.environ.get("SUPABASE_URL") or "").strip()).hostname or ""
    project = host.split(".", 1)[0]
    if not token.startswith("sbp_") or not project:
        raise RuntimeError("Supabase management credentials are missing")
    request = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{project}/database/query",
        data=json.dumps({"query": sql}).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            return json.loads(response.read().decode() or "[]")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode()[:500]
        raise RuntimeError(f"Supabase query failed with HTTP {exc.code}: {detail}") from exc


def live_index():
    rows = query(
        "SELECT indexname, indexdef FROM pg_indexes "
        "WHERE schemaname='public' AND tablename='grok_drive_index' "
        f"AND indexname='{INDEX}'"
    )
    return rows[0] if rows else None


def main() -> None:
    load_dotenv(ROOT / ".env", override=False)
    before = live_index()
    if not before:
        query(MIGRATION.read_text(encoding="utf-8"))
    after = live_index()
    if not after or "hnsw" not in str(after.get("indexdef") or "").lower() or "vector_cosine_ops" not in str(after.get("indexdef") or ""):
        raise SystemExit("production HNSW cosine index was not verified")
    print(json.dumps({"ok": True, "created": before is None, "index": after["indexname"], "method": "hnsw", "operator": "vector_cosine_ops"}))


if __name__ == "__main__":
    main()
