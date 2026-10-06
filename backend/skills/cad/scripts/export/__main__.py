"""``python scripts/export`` → ``cadgen glb|stl|3mf build``."""

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
    parser = argparse.ArgumentParser(prog="scripts/export")
    parser.add_argument("target", help="Python @step/gen_step source or a STEP document.")
    parser.add_argument("--glb", nargs="?", const="__default__", metavar="OUTPUT")
    parser.add_argument("--stl", nargs="?", const="__default__", metavar="OUTPUT")
    parser.add_argument("--3mf", dest="three_mf", nargs="?", const="__default__", metavar="OUTPUT")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--mesh-tolerance", type=float)
    parser.add_argument("--mesh-angular-tolerance", type=float)
    return parser


def _default_out(target: str, ext: str) -> str:
    return str(Path(target).with_suffix(ext))


if __name__ == "__main__":
    args = build_parser().parse_args()
    target = Path(args.target)
    if target.suffix.lower() == ".py":
        step_argv = [str(target)]
        if args.glb:
            step_argv.extend(["--glb", args.glb if args.glb != "__default__" else _default_out(args.target, ".glb")])
        if args.stl:
            step_argv.extend(["--stl", args.stl if args.stl != "__default__" else _default_out(args.target, ".stl")])
        if args.three_mf:
            step_argv.extend(
                ["--3mf", args.three_mf if args.three_mf != "__default__" else _default_out(args.target, ".3mf")]
            )
        if args.force:
            step_argv.append("--force")
        if args.verbose:
            step_argv.append("--verbose")
        raise SystemExit(step_main(step_argv))

    extra: list[str] = []
    if args.force:
        extra.append("--force")
    if args.verbose:
        extra.append("--verbose")
    mapping = (
        ("glb", args.glb, ".glb"),
        ("stl", args.stl, ".stl"),
        ("3mf", args.three_mf, ".3mf"),
    )
    for fmt, value, ext in mapping:
        if not value:
            continue
        out = _default_out(args.target, ext) if value == "__default__" else value
        code = cadgen_main([fmt, "build", str(target), str(out), *extra])
        if code:
            raise SystemExit(code)
    raise SystemExit(0)
