#!/usr/bin/env python3
"""Capture iso / top / front PNGs of a published VibeCAD GLB.

VibeCAD visual kernel equivalent of core.capture_view_screenshot (viewport image).
This is not Jake cadgen inspect/snapshot.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
IMG2 = HERE.parents[1] / "img2threejs" / "scripts" / "capture_views.py"


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--glb", type=Path, required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--stem", required=True)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    if not IMG2.is_file():
        print("error: img2threejs capture_views.py missing (Three.js viewer)", file=sys.stderr)
        return 2
    # Load the Playwright/Three viewer without importing cadgen.
    ns: dict = {"__name__": "vibecad_capture_views", "__file__": str(IMG2)}
    exec(IMG2.read_text(encoding="utf-8"), ns)
    capture = ns["capture"]
    try:
        payload = capture(
            asset=args.glb,
            kind="glb",
            out_dir=args.out_dir,
            stem=args.stem,
            up_axis="z",
        )
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps(payload, indent=2))
    else:
        print(payload.get("file") or "")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
