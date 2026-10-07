"""``python scripts/gen`` → ``python scripts/step`` (Jake 0.5 has no gen CLI)."""

from __future__ import annotations

import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from step.cli import main as step_main


def translate_gen_argv(argv: list[str]) -> list[str]:
    out: list[str] = []
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg == "--write":
            if i + 1 < len(argv) and not argv[i + 1].startswith("-"):
                out.extend(["-o", argv[i + 1]])
                i += 2
                continue
            i += 1
            continue
        if arg.startswith("--write="):
            out.extend(["-o", arg.split("=", 1)[1]])
            i += 1
            continue
        if arg == "--write-step":
            i += 1
            continue
        out.append(arg)
        i += 1
    return out


if __name__ == "__main__":
    raise SystemExit(step_main(translate_gen_argv(sys.argv[1:])))
