"""``python scripts/snapshot`` → ``cadgen snapshot`` (Jake text-to-cad 0.5).

Translates the 0.4 ``--input`` / ``--output`` flags CAD 2.0 still sends.
"""

from __future__ import annotations

import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from _r3d_cadgen import cadgen_main


def translate_legacy_argv(argv: list[str]) -> list[str]:
    out: list[str] = []
    input_path: str | None = None
    output_path: str | None = None
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg in {"--input", "-i"} and i + 1 < len(argv):
            input_path = argv[i + 1]
            i += 2
            continue
        if arg.startswith("--input="):
            input_path = arg.split("=", 1)[1]
            i += 1
            continue
        if arg in {"--output", "-o"} and i + 1 < len(argv):
            output_path = argv[i + 1]
            i += 2
            continue
        if arg.startswith("--output="):
            output_path = arg.split("=", 1)[1]
            i += 1
            continue
        out.append(arg)
        i += 1
    if any(item == "--job" or item.startswith("--job=") for item in out):
        return out
    prefix: list[str] = []
    if input_path:
        prefix.append(input_path)
    if output_path:
        prefix.append(output_path)
    return prefix + out


if __name__ == "__main__":
    raise SystemExit(cadgen_main(["snapshot", *translate_legacy_argv(sys.argv[1:])]))
