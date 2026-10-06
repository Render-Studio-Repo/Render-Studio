#!/usr/bin/env python3
"""Print indexed_count vs disk_count for Cursor transcripts. No secrets, no bodies."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services import cursor_transcript_index as cti
from backend.services import prompt_trace_service as trace


def main() -> int:
    indexed = list(trace.indexed_prompts() or [])
    before = cti.coverage(indexed=indexed)
    print("before merge (prompts.json vs disk jsonl)")
    cti.print_coverage(before)
    served = cti.merge_missing(indexed)
    after = cti.coverage(indexed=served)
    print("after merge (history/search_chat_logs serve)")
    cti.print_coverage(after)
    print(f"excerpt_cap={after.get('excerpt_cap')} include_subagents={after.get('include_subagents')}")
    return 0 if after.get("served_count") == after.get("disk_count") else 1


if __name__ == "__main__":
    raise SystemExit(main())
