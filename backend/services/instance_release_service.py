"""Signed stable release pointer for independently hosted Render instances."""

from __future__ import annotations

import hmac
import json
import re
from pathlib import Path
from typing import Any

from backend.config import settings

REPOSITORY = "wprojects/Render-Studio"
STABLE_BRANCH = "master"
def _path() -> Path:
    return Path(settings.data_dir).resolve() / "instance_release.json"


def _normalize(payload: dict[str, Any]) -> dict[str, Any]:
    sha = str(payload.get("commit_sha") or "").strip().lower()
    repository = str(payload.get("repository") or "").strip()
    branch = str(payload.get("branch") or "").strip()
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("Release commit is invalid.")
    if repository.lower() != REPOSITORY.lower() or branch != STABLE_BRANCH:
        raise ValueError("Release must come from the official stable branch.")
    return {
        "ok": True,
        "channel": "stable",
        "repository": REPOSITORY,
        "branch": STABLE_BRANCH,
        "version": f"stable-{sha[:12]}",
        "commit_sha": sha,
        "notes": str(payload.get("notes") or "Render Studio stable update").splitlines()[0].strip()[:240],
        "published_at": str(payload.get("published_at") or "")[:40],
    }


def publish(payload: dict[str, Any], token: str) -> dict[str, Any]:
    expected = str(getattr(settings, "render3d_release_webhook_token", "") or "").strip()
    if not expected or not hmac.compare_digest(str(token or ""), expected):
        raise PermissionError("Release publisher authentication failed.")
    release = _normalize(payload)
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(release, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)
    return dict(release)


def latest() -> dict[str, Any]:
    path = _path()
    if not path.is_file():
        raise FileNotFoundError("No stable release has been published yet.")
    return _normalize(json.loads(path.read_text(encoding="utf-8")))
