#!/usr/bin/env python3
"""Ship a user-facing milestone: shipped.json + milestones.js + Updates cache.

Usage:
  python scripts/add-milestone.py \\
    --id share-folder-v2 \\
    --title "Share folder improvements" \\
    --summary "Pick teammates from the dropdown without retyping email." \\
    --kind feature \\
    --visual /docs/media/share-folder.gif \\
    --href /getting-started.html#share-folders

Kinds: feature | tool
Skip pure UI polish — only ship workflow/tool changes.

Agents: this is enough. Prefer `@milestone` in the worklog heading *or* this script.
`scan-milestones.py` (hourly LaunchAgent) and `/updates.html` (fetches shipped.json)
pick it up without a CMS pass.
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
MILESTONES = ROOT / "frontend" / "docs" / "updates" / "milestones.js"
SHIPPED = ROOT / "frontend" / "docs" / "updates" / "shipped.json"


def js_str(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", " ") + '"'


def upsert_shipped(row: dict) -> None:
    data: dict = {"items": []}
    if SHIPPED.is_file():
        raw = json.loads(SHIPPED.read_text(encoding="utf-8"))
        data = raw if isinstance(raw, dict) else {"items": list(raw or [])}
        data.setdefault("items", [])
    items = [x for x in data["items"] if isinstance(x, dict)]
    existing = next((x for x in items if x.get("id") == row["id"]), None)
    if existing:
        existing.update({k: v for k, v in row.items() if v})
    else:
        items.insert(0, row)
    data["items"] = items
    SHIPPED.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def insert_milestone_js(args) -> bool:
    text = MILESTONES.read_text(encoding="utf-8")
    if f'id: "{args.id}"' in text or f"id: '{args.id}'" in text:
        return False
    fields = [
        f'    id: {js_str(args.id)},',
        f'    date: {js_str(args.date)},',
        f'    kind: {js_str(args.kind)},',
        f'    title: {js_str(args.title)},',
        f'    summary:',
        f'      {js_str(args.summary)},',
    ]
    if args.visual:
        fields.append(f'    visual: {js_str(args.visual)},')
    if args.href:
        fields.append(f'    href: {js_str(args.href)},')
    block = "  {\n" + "\n".join(fields) + "\n  },\n"
    marker = "export const MILESTONE_UPDATES = [\n"
    if marker not in text:
        raise SystemExit("Could not find MILESTONE_UPDATES array")
    MILESTONES.write_text(text.replace(marker, marker + block, 1), encoding="utf-8")
    return True


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--id", required=True, help="Stable kebab-case id")
    p.add_argument("--title", required=True)
    p.add_argument("--summary", required=True)
    p.add_argument("--kind", choices=("feature", "tool"), default="feature")
    p.add_argument("--date", default=date.today().isoformat())
    p.add_argument("--visual", default="", help="Image/GIF URL under /docs/media/")
    p.add_argument("--href", default="", help="Optional docs deep link")
    p.add_argument("--skip-scan", action="store_true")
    args = p.parse_args()

    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", args.id):
        raise SystemExit("--id must be kebab-case")

    row = {
        "id": args.id,
        "date": args.date,
        "kind": args.kind,
        "title": args.title.strip(),
        "summary": args.summary.strip(),
        "href": args.href.strip() or "/updates.html",
    }
    if args.visual.strip():
        row["visual"] = args.visual.strip()

    upsert_shipped(row)
    added = insert_milestone_js(args)
    print(f"{'Added' if added else 'Updated'} {args.id} → shipped.json" + (" + milestones.js" if added else " (milestones.js already had id)"))

    if args.skip_scan:
        return
    scan = ROOT / "scripts" / "scan-milestones.py"
    subprocess.run(
        [sys.executable, str(scan), "--skip-social", "--quiet"],
        cwd=str(ROOT),
        check=False,
    )


if __name__ == "__main__":
    main()
