from __future__ import annotations

import os
from typing import Mapping


_CREDENTIAL_ENV = (
    "OPENAI_API_KEY",
    "CODEX_API_KEY",
    "CODEX_ACCESS_TOKEN",
    "OPENAI_FEDERATION_RULE_ID",
    "OPENAI_IDENTITY_TOKEN_FILE",
)


def codex_launch_env(
    selected: Mapping[str, str], *, inherited: Mapping[str, str] | None = None
) -> dict[str, str]:
    env = dict(os.environ if inherited is None else inherited)
    for name in _CREDENTIAL_ENV:
        env.pop(name, None)
    env.update(selected)
    return env
