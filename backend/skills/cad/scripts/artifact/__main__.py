"""``python scripts/artifact`` → ``cadgen step compile`` (Jake 0.5)."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from _r3d_cadgen import cadgen_main
from step.cli import main as step_main


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="scripts/artifact")
    parser.add_argument("target")
    parser.add_argument("--kind", choices=("part", "assembly"))
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--mesh-tolerance", type=float)
    parser.add_argument("--mesh-angular-tolerance", type=float)
    return parser


if __name__ == "__main__":
    args = build_parser().parse_args()
    target = Path(args.target)
    extra: list[str] = []
    if args.force:
        extra.append("--force")
    if args.verbose:
        extra.append("--verbose")
    if target.suffix.lower() == ".py":
        raise SystemExit(step_main([str(target), *extra]))
    argv = ["step", "compile", str(target), *extra]
    raise SystemExit(cadgen_main(argv))
