"""Render Studio CAD 2.0 entry: Jake text-to-cad 0.5 + legacy gen_step().

Jake 0.5 generation has no CLI — ``python model.py`` runs the ``@step`` model.
CAD 2.0, Codex, and the leftover loop still call::

    python scripts/step part.py -o part.step --glb part.glb --stl part.stl --3mf part.3mf --force

This wrapper:

- runs native ``@step`` scripts as ``python <model>.py --force``
- wraps legacy ``gen_step()`` / ``gen_exploded()`` in a one-shot ``@step`` runner
- exports meshes with ``cadgen glb|stl|3mf build``
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from collections.abc import Sequence
from pathlib import Path

_SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from _r3d_cadgen import _ensure_node, cadgen_main  # noqa: E402


def _split_target(raw: str) -> tuple[str, str | None]:
    text = str(raw)
    if "=" in text:
        source, output = text.split("=", 1)
        return source, output
    return text, None


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="scripts/step",
        description="Run a cadgen @step model or wrap legacy gen_step(), then export meshes.",
    )
    parser.add_argument(
        "targets",
        nargs="+",
        help="@step / gen_step() Python source, a STEP document, or SOURCE=OUTPUT.step pair.",
    )
    parser.add_argument("-o", "--output", metavar="OUTPUT.step", help="Write this STEP path.")
    parser.add_argument("--glb", metavar="OUTPUT", help="Export a native GLB sidecar.")
    parser.add_argument("--stl", metavar="OUTPUT", help="Export an STL sidecar.")
    parser.add_argument("--3mf", dest="three_mf", metavar="OUTPUT", help="Export a 3MF sidecar.")
    parser.add_argument("--force", action="store_true", help="Rebuild even when artifacts look current.")
    parser.add_argument("--verbose", action="store_true", help="Show cadgen progress.")
    parser.add_argument("--kind", choices=("part", "assembly"), help=argparse.SUPPRESS)
    parser.add_argument("--skip-step-write", action="store_true", help=argparse.SUPPRESS)
    return parser


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ""


def _is_step_document(path: Path) -> bool:
    return path.suffix.lower() in {".step", ".stp"}


def _is_step_model(source: str) -> bool:
    return bool(re.search(r"(^|\n)[ \t]*@step(\s|\(|\n|$)", source or ""))


def _has_fn(source: str, name: str) -> bool:
    return bool(re.search(rf"(^|\n)[ \t]*def[ \t]+{re.escape(name)}\s*\(", source or ""))


def _run_python(script: Path, extra: list[str]) -> int:
    env = os.environ.copy()
    env.setdefault("CADGEN_DAEMON", "0")
    cmd = [sys.executable, str(script), *extra]
    return int(subprocess.call(cmd, env=env))


def _write_legacy_runner(source: Path, fn_name: str, step_out: Path) -> Path:
    runner = source.parent / f".r3d_{source.stem}_{fn_name}.py"
    src_lit = str(source.resolve()).replace("\\", "\\\\").replace('"', '\\"')
    out_lit = str(step_out.resolve()).replace("\\", "\\\\").replace('"', '\\"')
    runner.write_text(
        (
            "# Render Studio cadgen 0.5 shim — generated, safe to delete\n"
            "from pathlib import Path\n"
            "import importlib.util\n"
            "from cadgen import step as cadgen_step\n"
            "\n"
            f'_SRC = Path(r"{src_lit}")\n'
            "_spec = importlib.util.spec_from_file_location(_SRC.stem, _SRC)\n"
            "_mod = importlib.util.module_from_spec(_spec)\n"
            "assert _spec is not None and _spec.loader is not None\n"
            "_spec.loader.exec_module(_mod)\n"
            "\n"
            f'@cadgen_step(out=r"{out_lit}")\n'
            "def _r3d_model():\n"
            f"    return _mod.{fn_name}()\n"
            "\n"
            "if __name__ == '__main__':\n"
            "    _r3d_model()\n"
        ),
        encoding="utf-8",
    )
    return runner


def _copy_if_needed(src: Path, dest: Path) -> None:
    if src.resolve() == dest.resolve():
        return
    if not src.is_file():
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(src.read_bytes())


def _export_meshes(step_path: Path, *, glb: str | None, stl: str | None, three_mf: str | None, force: bool, verbose: bool) -> int:
    extra = []
    if force:
        extra.append("--force")
    if verbose:
        extra.append("--verbose")
    mapping = (
        ("glb", glb),
        ("stl", stl),
        ("3mf", three_mf),
    )
    for fmt, out in mapping:
        if not out:
            continue
        argv = [fmt, "build", str(step_path), str(out), *extra]
        code = cadgen_main(argv)
        if code:
            return code
    return 0


def _compile_document(step_path: Path, *, force: bool, verbose: bool) -> int:
    argv = ["step", "compile", str(step_path)]
    if force:
        argv.append("--force")
    if verbose:
        argv.append("--verbose")
    return cadgen_main(argv)


def _model_flags(*, force: bool, verbose: bool) -> list[str]:
    flags: list[str] = []
    if force:
        flags.append("--force")
    if verbose:
        flags.append("--verbose")
    return flags


def main(argv: Sequence[str] | None = None) -> int:
    _ensure_node()
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)

    sources: list[str] = []
    pair_output: str | None = None
    for raw in args.targets:
        source, output = _split_target(raw)
        sources.append(source)
        if output:
            pair_output = output
    write_path = args.output or pair_output
    flags = _model_flags(force=bool(args.force), verbose=bool(args.verbose))

    if len(sources) != 1:
        if args.glb or args.stl or args.three_mf or write_path:
            parser.error("--output / --glb / --stl / --3mf require exactly one target")
        code = 0
        for source in sources:
            code = main(
                [source, *(["--force"] if args.force else []), *(["--verbose"] if args.verbose else [])]
            )
            if code:
                return code
        return 0

    target = Path(sources[0])
    if _is_step_document(target):
        if not args.skip_step_write:
            code = _compile_document(target, force=bool(args.force), verbose=bool(args.verbose))
            if code:
                return code
        return _export_meshes(
            target,
            glb=args.glb,
            stl=args.stl,
            three_mf=args.three_mf,
            force=bool(args.force),
            verbose=bool(args.verbose),
        )

    if not target.is_file():
        parser.error(f"source not found: {target}")

    text = _read(target)
    default_step = target.with_suffix(".step")
    step_out = Path(write_path) if write_path else default_step

    if not args.skip_step_write:
        if _is_step_model(text):
            code = _run_python(target, flags)
            if code:
                return code
            sibling = default_step
            if not sibling.is_file():
                # @step(out=...) may relocate; pick the newest .step beside the script.
                siblings = sorted(target.parent.glob(f"{target.stem}*.step"), key=lambda p: p.stat().st_mtime)
                if siblings:
                    sibling = siblings[-1]
            _copy_if_needed(sibling, step_out)
        elif _has_fn(text, "gen_step"):
            runner = _write_legacy_runner(target, "gen_step", step_out)
            try:
                code = _run_python(runner, flags)
            finally:
                try:
                    runner.unlink()
                except OSError:
                    pass
            if code:
                return code
        else:
            parser.error(
                f"{target} is not a cadgen @step model and does not define gen_step()"
            )

        if _has_fn(text, "gen_exploded"):
            exploded = step_out.with_name(f"{step_out.stem}_exploded{step_out.suffix or '.step'}")
            runner = _write_legacy_runner(target, "gen_exploded", exploded)
            try:
                _run_python(runner, flags)
            finally:
                try:
                    runner.unlink()
                except OSError:
                    pass
            if exploded.is_file():
                # Viewport live-draw is GLB-only. Never tessellate exploded STL/3MF
                # as part of generate — those sidecars are huge and are not drawn.
                _export_meshes(
                    exploded,
                    glb=str(exploded.with_suffix(".glb")) if args.glb else None,
                    stl=None,
                    three_mf=None,
                    force=bool(args.force),
                    verbose=bool(args.verbose),
                )

    if not step_out.is_file():
        sys.stderr.write(f"scripts/step did not produce {step_out}\n")
        return 1

    return _export_meshes(
        step_out,
        glb=args.glb,
        stl=args.stl,
        three_mf=args.three_mf,
        force=bool(args.force),
        verbose=bool(args.verbose),
    )


if __name__ == "__main__":
    raise SystemExit(main())
