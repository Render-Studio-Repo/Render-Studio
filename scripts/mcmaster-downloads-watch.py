#!/usr/bin/env python3
"""Watch a local Downloads folder for McMaster CAD and upload into a Render3D project.

McMaster always saves CAD to the browser Downloads folder (it cannot write into
Render3D directly). This script bridges that gap:

  1. Download STEP/STL/etc from McMaster as usual
  2. This watcher detects the new file
  3. Uploads it into your current Render3D project

Usage:
  export RENDER3D_API="https://render3d.app"          # or http://localhost:8001
  export RENDER3D_TOKEN="your-jwt-token"              # from browser localStorage / auth
  export RENDER3D_PROJECT_ID="your-project-id"
  # optional:
  export RENDER3D_DOWNLOADS="$HOME/Downloads"

  python3 scripts/mcmaster-downloads-watch.py

 monitors for .step .stp .stl .obj .glb .gltf .3mf .iges .igs and uploads each once.
"""

from __future__ import annotations

import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

CAD_SUFFIXES = {
    ".step",
    ".stp",
    ".stl",
    ".obj",
    ".glb",
    ".gltf",
    ".3mf",
    ".iges",
    ".igs",
    ".sat",
    ".sldprt",
    ".x_t",
    ".x_b",
}

API = os.environ.get("RENDER3D_API", "https://render3d.app").rstrip("/")
TOKEN = os.environ.get("RENDER3D_TOKEN", "").strip()
PROJECT_ID = os.environ.get("RENDER3D_PROJECT_ID", "").strip()
DOWNLOADS = Path(
    os.environ.get("RENDER3D_DOWNLOADS")
    or os.path.expanduser("~/Downloads")
).expanduser()  # set to the same folder you chose in McMaster → Set download folder
POLL_SEC = float(os.environ.get("RENDER3D_WATCH_POLL", "2"))
STABLE_SEC = float(os.environ.get("RENDER3D_WATCH_STABLE", "1.5"))


def die(msg: str, code: int = 1) -> None:
    print(f"error: {msg}", file=sys.stderr)
    raise SystemExit(code)


def upload(path: Path) -> dict:
    boundary = f"----render3d{int(time.time() * 1000)}"
    data = path.read_bytes()
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{path.name}"\r\n'
        f"Content-Type: application/octet-stream\r\n\r\n"
    ).encode("utf-8") + data + f"\r\n--{boundary}--\r\n".encode("utf-8")
    req = urllib.request.Request(
        f"{API}/api/projects/{PROJECT_ID}/upload",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
    return {"ok": True, "body": raw[:500]}


def file_stable(path: Path) -> bool:
    try:
        size1 = path.stat().st_size
        time.sleep(STABLE_SEC)
        size2 = path.stat().st_size
        return size1 == size2 and size2 > 0
    except OSError:
        return False


def main() -> None:
    if not TOKEN:
        die("set RENDER3D_TOKEN (JWT from a signed-in Render3D session)")
    if not PROJECT_ID:
        die("set RENDER3D_PROJECT_ID")
    if not DOWNLOADS.is_dir():
        die(f"Downloads folder not found: {DOWNLOADS}")

    print(f"watching {DOWNLOADS}")
    print(f"uploading to {API}/api/projects/{PROJECT_ID}/upload")
    seen: set[str] = set()
    for p in DOWNLOADS.iterdir():
        if p.is_file() and p.suffix.lower() in CAD_SUFFIXES:
            seen.add(f"{p.name}:{p.stat().st_mtime_ns}:{p.stat().st_size}")

    while True:
        try:
            for path in sorted(DOWNLOADS.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
                if not path.is_file():
                    continue
                if path.suffix.lower() not in CAD_SUFFIXES:
                    continue
                # skip partial browser downloads
                if path.name.endswith((".crdownload", ".part", ".tmp", ".download")):
                    continue
                key = f"{path.name}:{path.stat().st_mtime_ns}:{path.stat().st_size}"
                if key in seen:
                    continue
                if not file_stable(path):
                    continue
                print(f"→ uploading {path.name} …", flush=True)
                try:
                    upload(path)
                    print(f"✓ inserted {path.name} into project {PROJECT_ID}", flush=True)
                    seen.add(key)
                except urllib.error.HTTPError as exc:
                    detail = exc.read().decode("utf-8", errors="replace")[:300]
                    print(f"✗ upload failed ({exc.code}): {detail}", file=sys.stderr, flush=True)
                    seen.add(key)  # avoid tight retry loop on permanent errors
                except Exception as exc:  # noqa: BLE001
                    print(f"✗ {exc}", file=sys.stderr, flush=True)
        except KeyboardInterrupt:
            print("\nstopped")
            return
        time.sleep(POLL_SEC)


if __name__ == "__main__":
    main()
