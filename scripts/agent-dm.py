#!/usr/bin/env python3
"""Allowed 'DM' = MCP rm_queue (to Cursor) or grok_group_chat (public). Not Slack. Not specialist-to-specialist."""
from __future__ import annotations

import argparse
import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _bot():
    spec = importlib.util.spec_from_file_location("gb", ROOT / "mcp/grok-bot/server.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod._load_dotenv_keys()
    return mod


def main() -> int:
    p = argparse.ArgumentParser(description="MCP stand-in for DMs")
    p.add_argument("--from", dest="frm", required=True, help="your legal agent id")
    p.add_argument("--to", default="cursor-engineer", help="cursor-engineer | group")
    p.add_argument("--text", required=True)
    args = p.parse_args()
    if args.frm == "cursor-engineer" and args.to != "group":
        print("COMM_NO_WAKE: do not queue as cursor-engineer", file=sys.stderr)
        return 2
    bot = _bot()
    if args.to in {"group", "sam", "public"}:
        out = bot.grok_group_chat({"action": "post", "agent": args.frm, "text": args.text})
    else:
        from backend.services import mcp_watchdog_service as wd

        out = wd.rm_queue({"agent": args.frm, "text": f"DM→{args.to}: {args.text}"})
    print(out)
    return 0 if out.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
