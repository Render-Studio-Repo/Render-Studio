#!/usr/bin/env python3
"""Apply grok_drive_index SQL and ingest local + staged Drive text. No secrets printed."""

from __future__ import annotations

import json
import os
import sys
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
os.chdir(REPO)

from dotenv import load_dotenv

load_dotenv(REPO / ".env", override=False)

from backend.services import grok_drive_index_service as idx


def apply_sql() -> str:
    token = (os.environ.get("SUPABASE_ACCESS_TOKEN") or "").strip()
    sql = (REPO / "integrations/supabase/migrations/010_grok_drive_index.sql").read_text(encoding="utf-8")
    if not token.startswith("sbp_"):
        return "skip-sql-no-pat"
    body = json.dumps({"query": sql}).encode()
    req = urllib.request.Request(
        "https://api.supabase.com/v1/projects/gudszkmcgncdnezfwidm/database/query",
        data=body,
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return "sql-" + str(resp.status)
    except urllib.error.HTTPError as exc:
        return "sql-err-" + str(exc.code) + "-" + exc.read().decode()[:240]


def layer_for(path: Path) -> str:
    name = path.name.lower()
    if "vision" in name or "whitepaper" in name or "start-every" in name:
        return "01-vision"
    if "api" in name or "agent-bus" in name:
        return "02-api"
    if "chat" in name or "convo" in name or "group-chat" in name or "mule" in name:
        return "03-convos"
    if "thought" in name or "report" in name:
        return "04-thoughts"
    if "log" in name or "jsonl" in name:
        return "05-logs"
    if "review" in name or "drive-canon" in name:
        return "00-home"
    return "00-home"


def ingest_path(path: Path, file_id: str | None = None, url: str = "") -> int:
    text = path.read_text(encoding="utf-8", errors="replace")
    fid = file_id or ("local:" + str(path.relative_to(REPO)))
    href = url or ("https://render3d.app/" + str(path.relative_to(REPO)).replace("frontend/", ""))
    return idx.ingest_doc(fid, path.name, href, layer_for(path), text[:80000])


def main() -> None:
    print(apply_sql())
    n = 0
    skip = {"CYCLE-20260916-AGENTS-BUNDLE.md", "CYCLE-BUNDLE-A.md", "CYCLE-BUNDLE-B.md"}
    files = [p for p in (REPO / "Getting-Started/agents").glob("*.md") if p.name not in skip]
    for extra in [
        REPO / "Getting-Started/whitepaper.md",
        REPO / "Getting-Started/agents/DRIVE-CANON-GROK-BOT.md",
        REPO / "frontend/docs/media/group-chat.jsonl",
        REPO / "frontend/docs/media/help-requests.jsonl",
        REPO / "ai-context/agent-bus/mule-outbox.jsonl",
    ]:
        if extra.is_file():
            files.append(extra)
    staging = REPO / "data/grok-bot/drive-index-src"
    if staging.is_dir():
        files += list(staging.rglob("*.md")) + list(staging.rglob("*.txt"))
    seen = set()
    for path in files:
        key = str(path.resolve())
        if key in seen:
            continue
        seen.add(key)
        try:
            added = ingest_path(path)
            n += added
            print("ok", path.name, added)
        except Exception as exc:
            print("fail", path.name, str(exc)[:160])
    probe = idx.search("mule harness drive dump", 5)
    print("indexed_chunks", n, "search_ok", probe.get("ok"), "mode", probe.get("mode"), "hits", len(probe.get("hits") or []))


if __name__ == "__main__":
    main()
