#!/usr/bin/env python3
"""Ship a product update: append shipped.json → sync milestones → Discord announce.

Example:
  python scripts/ship-update.py \\
    --id mobile-app-chrome \\
    --title "App-like mobile studio chrome" \\
    --summary "Hamburger menu, profile top-right, tools FAB, locked viewport." \\
    --href "/updates.html" \\
    --kind feature
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SHIPPED = ROOT / "frontend" / "docs" / "updates" / "shipped.json"
sys.path.insert(0, str(ROOT))


def kebab(value: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "-", (value or "").strip().lower()).strip("-")
    return re.sub(r"-{2,}", "-", s) or "update"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--id", default="")
    ap.add_argument("--title", required=True)
    ap.add_argument("--summary", required=True)
    ap.add_argument("--kind", default="feature", choices=["feature", "tool", "fix", "improve"])
    ap.add_argument("--href", default="/updates.html")
    ap.add_argument("--visual", default="")
    ap.add_argument("--date", default=date.today().isoformat())
    ap.add_argument("--skip-discord", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    uid = (args.id or kebab(args.title)).strip()
    row = {
        "id": uid,
        "date": args.date,
        "kind": args.kind,
        "title": args.title.strip(),
        "summary": args.summary.strip(),
        "href": args.href.strip() or "/updates.html",
    }
    if args.visual.strip():
        row["visual"] = args.visual.strip()

    data = {"items": []}
    if SHIPPED.is_file():
        data = json.loads(SHIPPED.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            data = {"items": list(data or [])}
        data.setdefault("items", [])

    existing_ids = {str(x.get("id")) for x in data["items"] if isinstance(x, dict)}
    if uid in existing_ids:
        print(f"shipped.json already has id={uid} — will still sync/announce")
    else:
        data["items"].insert(0, row)
        if args.dry_run:
            print(json.dumps(row, indent=2))
        else:
            SHIPPED.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
            print(f"Added {uid} to {SHIPPED.relative_to(ROOT)}")

    if args.dry_run:
        return 0

    scan = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "scan-milestones.py")],
        cwd=str(ROOT),
        check=False,
    )
    if scan.returncode != 0:
        print("scan-milestones failed", file=sys.stderr)
        return scan.returncode

    if args.skip_discord:
        return 0

    from backend.services import discord_updates_service as discord

    if not discord.configured():
        print("Discord not configured — skipped")
        return 0
    try:
        result = discord.announce_update(row)
        print(json.dumps(result, indent=2))
        if not result.get("ok"):
            st = discord.connection_status()
            if st.get("invite_url"):
                print(f"Invite bot: {st['invite_url']}")
            return 1
    except Exception as err:
        print(f"Discord announce failed: {err}", file=sys.stderr)
        st = discord.connection_status()
        print(f"Invite bot: {st.get('invite_url')}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
