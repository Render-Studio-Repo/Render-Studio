#!/usr/bin/env python3
"""Offline swarm credit while Studio :8001 Python is stale.

Reads data/prompt-trace/live-prompts.jsonl plus confirm-fixed / checklist
sqlite sidecars, then ingest_live_outcome → period rollups + league_cycle.
Same log_id is not credited twice today. Credit is a dashboard metric.

  /Users/sam/Render-Studio/.venv/bin/python scripts/ingest-offline-credit.py
  grok_debugger action=ingest_jsonl   (alias: rollup_live)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services import debugger_swarm_service as dss


def main() -> int:
    out = dss.ingest_offline_jsonl({
        "snapshot_id": "cad-offline-jsonl",
        "agent_id": "cursor",
        "peer_id": "grok",
        "user_id": "sam-local",
        "project_id": "5bf8e783",
        "instance_id": "501",
    })
    print(json.dumps({
        "ok": out.get("ok"),
        "ingest": out.get("ingest"),
        "n_credited": out.get("n_credited"),
        "n_skipped": out.get("n_skipped"),
        "credited": out.get("credited"),
        "skipped": out.get("skipped"),
        "periods": out.get("periods"),
        "cycle": out.get("cycle"),
        "auto_fire": out.get("auto_fire"),
        "license": out.get("license"),
    }, indent=2))
    return 0 if out.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
