"""Optional read-only MCP v2 adapter for the local viewport observation store.

Run with the official MCP Python SDK v2 CLI: mcp run mcp_server.py
The SDK is an optional dependency and is not bundled in this repository.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

from mcp.server import MCPServer

from training_plan import next_step

DATA = Path(os.environ.get("OPENARM_LAB_DATA", Path(__file__).resolve().parent / "runs"))
ID = re.compile(r"^[a-zA-Z0-9_-]{1,80}$")
mcp = MCPServer("openarm-teleop-lab")


@mcp.tool()
def latest_viewport_observation() -> dict:
    """Read the most recent simulation-only headset, controller and feature observation."""
    path = DATA / "latest.json"
    return json.loads(path.read_text()) if path.exists() else {"status": "empty"}


@mcp.tool()
def episode_summary(episode_id: str) -> dict:
    """Read a recorded episode summary and sample count, without raw pose stream."""
    if not ID.fullmatch(episode_id):
        return {"error": "invalid episode id"}
    path = DATA / f"{episode_id}.json"
    if not path.exists():
        return {"error": "episode not found"}
    row = json.loads(path.read_text())
    return {"episode_id": row["episode_id"], "prompt": row["prompt"],
            "rig_version": row["rig_version"], "status": row["status"],
            "samples": row["samples"], "latest_sample": row.get("latest_sample"),
            "trial_plan": next_step(row.get("trials", [])),
            "note": "Viewport synthetic trials are not independent model evaluation"}


@mcp.tool()
def sample_window(episode_id: str, start_sequence: int = 0, limit: int = 20) -> dict:
    """Read a bounded source-linked pose window for debugging a specific motion or trigger edge."""
    if not ID.fullmatch(episode_id):
        return {"error": "invalid episode id"}
    path = DATA / f"{episode_id}.jsonl"
    if not path.exists():
        return {"error": "episode not found"}
    limit = max(1, min(limit, 50))
    items = []
    for line in path.read_text().splitlines():
        row = json.loads(line)
        if row.get("sequence", -1) >= start_sequence:
            items.append(row)
            if len(items) >= limit:
                break
    return {"episode_id": episode_id, "samples": items,
            "source": str(path), "start_sequence": start_sequence}
