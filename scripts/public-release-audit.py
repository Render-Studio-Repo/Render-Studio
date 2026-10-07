#!/usr/bin/env python3
"""Fail when a public release contains runtime data, credentials, or private admin defaults."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FORBIDDEN_PARTS = {
    ".env",
    ".venv",
    "backups",
    "data",
    "logs",
    "node_modules",
    "output",
    "projects",
    "tmp",
}
FORBIDDEN_PREFIXES = (
    "backend/local_private/",
    "demos/bambu-funding/out/",
    "frontend/_archive/",
    "frontend/sandbox/live/prompts/",
    "frontend/sandbox/live/wiring/",
    "scripts/gif-demos/raw/",
    "server-configurations/profiles/enterprise-private/",
    "frontend/admin/",
    "frontend/pages/admin-dashboard.html",
)
FORBIDDEN_EXACT = {
    "frontend/admin-instance-network.js",
    "frontend/admin-marketplace-moderation.js",
    "frontend/super-admin.html",
}
SECRET_PATTERNS = {
    "OpenAI key": re.compile(rb"(?:sk-(?:proj|svcacct)-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,})"),
    "GitHub token": re.compile(rb"gh[pousr]_[A-Za-z0-9_]{20,}"),
    "Supabase token": re.compile(rb"(?:sbp_|sb_secret_)[A-Za-z0-9_-]{20,}"),
    "AWS access key": re.compile(rb"AKIA[0-9A-Z]{16}"),
    "private key": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
}
PRIVILEGE_FILES = (
    "backend/main.py",
    "backend/services/platform_roles_service.py",
    "frontend/studio/app.js",
    "frontend/studio/auth.js",
)
PRIVATE_ADMIN_IDENTITIES = re.compile(
    rb"(?:a1projects@protonmail\.com|a1projects\.usa@gmail\.com|samwins\.stead@gmail\.com|sam@smartcallusa\.com|mtgraytech@gmail\.com)",
    re.I,
)


def tracked_paths() -> list[str]:
    output = subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT)
    return [value.decode("utf-8") for value in output.split(b"\0") if value]


def main() -> int:
    errors: list[str] = []
    legacy_dashboard = ROOT / "frontend" / "admin-dashboard.html"
    if legacy_dashboard.is_file() and b"data-public-instance-management-only" not in legacy_dashboard.read_bytes():
        errors.append("public admin dashboard must redirect to current-instance management")
    for relative in tracked_paths():
        path = Path(relative)
        parts = set(path.parts)
        if parts & FORBIDDEN_PARTS or relative.startswith(FORBIDDEN_PREFIXES) or relative in FORBIDDEN_EXACT:
            errors.append(f"forbidden public path: {relative}")
            continue
        if path.suffix.lower() in {".bak", ".db", ".pem", ".sqlite"}:
            errors.append(f"forbidden public file type: {relative}")
            continue
        absolute = ROOT / path
        if not absolute.exists():
            continue
        if absolute.is_symlink():
            continue
        try:
            raw = absolute.read_bytes()
        except OSError as exc:
            errors.append(f"could not read {relative}: {exc}")
            continue
        if b"\0" in raw[:8192]:
            continue
        generated_or_test = (
            "/tests/" in f"/{relative}"
            or "/dist/" in f"/{relative}"
            or relative.endswith((".map", ".test.js", ".test.mjs"))
        )
        if not generated_or_test:
            for label, pattern in SECRET_PATTERNS.items():
                if pattern.search(raw):
                    errors.append(f"possible {label}: {relative}")
        if relative in PRIVILEGE_FILES and PRIVATE_ADMIN_IDENTITIES.search(raw):
            errors.append(f"private admin identity in privilege code: {relative}")
    if errors:
        print("PUBLIC_RELEASE_AUDIT blocked:")
        print("\n".join(f"- {error}" for error in errors))
        return 2
    print(f"PUBLIC_RELEASE_AUDIT passed for {len(tracked_paths())} tracked files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
