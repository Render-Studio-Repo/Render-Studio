#!/usr/bin/env python3
"""Append a milestone to frontend/docs/updates/milestones.js (newest first).

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
"""

from __future__ import annotations

import argparse
import re
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MILESTONES = ROOT / "frontend" / "docs" / "updates" / "milestones.js"


def js_str(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", " ") + '"'


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--id", required=True, help="Stable kebab-case id")
    p.add_argument("--title", required=True)
    p.add_argument("--summary", required=True)
    p.add_argument("--kind", choices=("feature", "tool"), default="feature")
    p.add_argument("--date", default=date.today().isoformat())
    p.add_argument("--visual", default="", help="Image/GIF URL under /docs/media/")
    p.add_argument("--href", default="", help="Optional docs deep link")
    args = p.parse_args()

    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", args.id):
        raise SystemExit("--id must be kebab-case")

    text = MILESTONES.read_text(encoding="utf-8")
    if f'id: "{args.id}"' in text or f"id: '{args.id}'" in text:
        raise SystemExit(f"Milestone id already exists: {args.id}")

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
    text = text.replace(marker, marker + block, 1)
    MILESTONES.write_text(text, encoding="utf-8")
    print(f"Added milestone {args.id} → {MILESTONES}")


if __name__ == "__main__":
    main()
