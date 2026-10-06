#!/usr/bin/env python3
"""Fan specialists onto MCP: hello first, then comms vote on conv_id."""

from __future__ import annotations

import importlib.util
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.services import mcp_watchdog_service as wd  # noqa: E402

MCP = ROOT / "mcp" / "grok-bot" / "server.py"
AGENTS = (
    "project-manager",
    "vibe-marketing",
    "vibe-sales",
    "vibe-rnd",
    "analytics",
    "clip-bot",
)


def grok_mod():
    spec = importlib.util.spec_from_file_location("grok_bot_mcp_fanout_wd", MCP)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(mod)
    mod._load_dotenv_keys()
    return mod


def one(mod, agent: str) -> dict:
    wd.hello({"agent": agent, "conv_id": wd.CONV_ID})
    prompt = wd.watchdog_prompt(agent) + "\nReply with vote=mcp_star|hybrid|slack on the first line, then 6-10 sentences."
    try:
        chat = mod.grok_chat(prompt, f"You are {agent}. Stay in lane. No secrets.")
    except Exception as exc:
        chat = {"ok": False, "error": str(exc)[:400], "text": ""}
    text = str(chat.get("text") or chat.get("error") or "")[:1500]
    low = text.lower()
    vote = "mcp_star"
    if "vote=slack" in low or low.startswith("slack"):
        vote = "slack"
    elif "vote=hybrid" in low or "hybrid" in low.split("\n", 1)[0]:
        vote = "hybrid"
    elif "vote=mcp_star" in low or "mcp_star" in low.split("\n", 1)[0]:
        vote = "mcp_star"
    out = wd.converse({"agent": agent, "conv_id": wd.CONV_ID, "vote": vote, "text": text or "keep mcp_star with conv_id"})
    return {"agent": agent, "vote": vote, "ok": bool(chat.get("ok", True)), "hello": True, "msg_id": out.get("msg_id")}


def main() -> dict:
    wd.hello({"agent": "cursor-engineer", "conv_id": wd.CONV_ID})
    wd.converse(
        {
            "agent": "cursor-engineer",
            "conv_id": wd.CONV_ID,
            "vote": "mcp_star",
            "text": wd.CURSOR_REC,
        }
    )
    mod = grok_mod()
    rows = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futs = {pool.submit(one, mod, agent): agent for agent in AGENTS}
        for fut in as_completed(futs):
            try:
                rows.append(fut.result())
            except Exception as exc:
                rows.append({"agent": futs[fut], "ok": False, "error": str(exc)[:240]})
    snap = wd.headcount()
    return {"ok": True, "rows": rows, "headcount": snap["headcount"], "decision": snap["decision"]}


if __name__ == "__main__":
    import json

    print(json.dumps(main(), indent=2)[:4000])
