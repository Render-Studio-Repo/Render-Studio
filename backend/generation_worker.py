"""Detached CAD/wiring generation process.

Runs in its own session so SIGTERM to uvicorn / launchd KeepAlive does not
kill in-flight AI+CAD work. Progress is persisted to ``generation.json``;
the HTTP process can restart and clients keep polling.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import traceback
from pathlib import Path


def main() -> int:
    os.environ["RENDER3D_GENERATION_WORKER"] = "1"
    parser = argparse.ArgumentParser(description="Render3D detached generation worker")
    parser.add_argument("--payload", required=True, help="JSON payload written by spawn_detached")
    args = parser.parse_args()
    payload_path = Path(args.payload)
    try:
        payload = json.loads(payload_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"generation_worker: cannot read payload {payload_path}: {exc}", file=sys.stderr)
        return 2
    target = str(payload.get("target") or "").strip()
    fn_args = payload.get("args") or []
    if "." not in target or not isinstance(fn_args, list):
        print(f"generation_worker: invalid payload target={target!r}", file=sys.stderr)
        return 2
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    log = logging.getLogger("render3d.generation_worker")
    try:
        from backend.services import generation_service

        project_raw = str(payload.get("project_path") or "").strip()
        trace_id = str(payload.get("trace_id") or payload_path.stem)
        if not project_raw and payload_path.parent.name == ".generation_jobs":
            project_raw = str(payload_path.parent.parent)
        if project_raw:
            generation_service.set_worker_pid(
                Path(project_raw), os.getpid(), trace_id=trace_id, detached=True
            )
    except Exception:
        logging.getLogger("render3d.generation_worker").warning(
            "Could not stamp generation worker pid",
            exc_info=True,
        )
    mod_name, fn_name = target.rsplit(".", 1)
    log.info("starting target=%s payload=%s pid=%s", target, payload_path, os.getpid())
    try:
        import importlib

        fn = getattr(importlib.import_module(mod_name), fn_name)
        fn(*fn_args)
    except Exception:
        traceback.print_exc()
        log.exception("detached generation failed target=%s", target)
        return 1
    log.info("finished target=%s", target)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
