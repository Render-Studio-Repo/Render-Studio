#!/usr/bin/env python3
"""Create stable local secrets and an instance identity for a fresh clone."""

from __future__ import annotations

import secrets
import stat
import sys
from pathlib import Path

from cryptography.fernet import Fernet

ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = ROOT / ".env"
sys.path.insert(0, str(ROOT))


def upsert_missing_env(path: Path, values: dict[str, str]) -> None:
    text = path.read_text(encoding="utf-8") if path.is_file() else ""
    lines = text.splitlines()
    found: set[str] = set()
    output: list[str] = []
    for line in lines:
        key, separator, current = line.partition("=")
        if separator and key in values:
            found.add(key)
            output.append(line if current.strip() else f"{key}={values[key]}")
        else:
            output.append(line)
    for key, value in values.items():
        if key not in found:
            output.append(f"{key}={value}")
    path.write_text("\n".join(output).rstrip() + "\n", encoding="utf-8")
    path.chmod(stat.S_IRUSR | stat.S_IWUSR)


def bootstrap(env_path: Path = ENV_PATH) -> str:
    upsert_missing_env(env_path, {
        "JWT_SECRET": secrets.token_urlsafe(48),
        "SECRETS_FERNET_KEY": Fernet.generate_key().decode("ascii"),
    })
    from backend.services import marketplace_config_service

    return str(marketplace_config_service.ensure_instance_identity().get("instance_id") or "")


if __name__ == "__main__":
    instance_id = bootstrap()
    print(f"Render instance id: {instance_id}")
    print("Private projects remain local. Marketplace and health sharing stay off until answered in setup.")
