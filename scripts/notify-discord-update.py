#!/usr/bin/env python3
"""Post product updates to the Render Studio Discord channel.

Examples:
  python scripts/notify-discord-update.py --status
  python scripts/notify-discord-update.py --title "Mobile tools FAB" --summary "..." --id mobile-tools-fab
  python scripts/notify-discord-update.py --from-shipped
  python scripts/notify-discord-update.py --sync-milestones
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.services import discord_updates_service as discord  # noqa: E402

SHIPPED = ROOT / "frontend" / "docs" / "updates" / "shipped.json"
MILESTONES = ROOT / "frontend" / "docs" / "updates" / "milestones.js"


def parse_milestones(text: str) -> list[dict]:
    rows: list[dict] = []
    for block in re.split(r"\n  \},\n", text):
        idm = re.search(r'id:\s*"([^"]+)"', block)
        if not idm:
            continue
        title = re.search(r'title:\s*"([^"]+)"', block)
        summary = re.search(r'summary:\s*\n?\s*"([^"]+)"', block)
        kind = re.search(r'kind:\s*"([^"]+)"', block)
        dt = re.search(r'date:\s*"([^"]+)"', block)
        visual = re.search(r'visual:\s*"([^"]+)"', block)
        href = re.search(r'href:\s*"([^"]+)"', block)
        rows.append(
            {
                "id": idm.group(1),
                "title": title.group(1) if title else idm.group(1),
                "summary": summary.group(1) if summary else "",
                "kind": kind.group(1) if kind else "feature",
                "date": dt.group(1) if dt else "",
                "visual": visual.group(1) if visual else "",
                "href": href.group(1) if href else "/updates.html",
            }
        )
    return rows


def load_shipped() -> list[dict]:
    if not SHIPPED.is_file():
        return []
    data = json.loads(SHIPPED.read_text(encoding="utf-8"))
    items = data.get("items") if isinstance(data, dict) else data
    return list(items or [])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--status", action="store_true", help="Check bot + channel access")
    ap.add_argument("--from-shipped", action="store_true", help="Post new shipped.json items")
    ap.add_argument("--sync-milestones", action="store_true", help="Post new milestones.js entries")
    ap.add_argument("--limit", type=int, default=0, help="Max items to post (0 = all new)")
    ap.add_argument("--force", action="store_true", help="Repost even if already sent")
    ap.add_argument("--id", default="")
    ap.add_argument("--title", default="")
    ap.add_argument("--summary", default="")
    ap.add_argument("--kind", default="feature")
    ap.add_argument("--href", default="/updates.html")
    ap.add_argument("--visual", default="")
    ap.add_argument("--text", default="", help="Send a plain text message instead of an embed")
    args = ap.parse_args()

    if args.status:
        st = discord.connection_status()
        print(json.dumps(st, indent=2))
        return 0 if st.get("configured") and not st.get("error") else 1

    if args.text:
        try:
            print(json.dumps(discord.announce_text(args.text), indent=2))
            return 0
        except Exception as err:
            print(f"ERROR: {err}", file=sys.stderr)
            return 1

    updates: list[dict] = []
    if args.from_shipped:
        updates.extend(load_shipped())
    if args.sync_milestones and MILESTONES.is_file():
        updates.extend(parse_milestones(MILESTONES.read_text(encoding="utf-8")))
    if args.title:
        updates.append(
            {
                "id": args.id or re.sub(r"[^a-z0-9]+", "-", args.title.lower()).strip("-"),
                "title": args.title,
                "summary": args.summary or args.title,
                "kind": args.kind,
                "href": args.href,
                "visual": args.visual,
            }
        )

    if not updates:
        ap.print_help()
        return 2

    # Prefer newest first for shipped/milestones (shipped.json is newest-first already).
    if args.limit and args.limit > 0:
        updates = updates[: args.limit]

    try:
        result = discord.announce_updates(updates, force=args.force)
    except Exception as err:
        print(f"ERROR: {err}", file=sys.stderr)
        st = discord.connection_status()
        if st.get("invite_url"):
            print(f"Invite bot: {st['invite_url']}", file=sys.stderr)
        return 1

    print(json.dumps(result, indent=2))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
