#!/usr/bin/env bash
# When the 8TB disk is plugged in, print the mount we will use for cold blobs.
set -euo pipefail
python3 - <<'PY'
from backend.services.agent_knowledge_lake import detect_cold_root, status, TOKEN
import json
print(json.dumps({"token": TOKEN, "detect": detect_cold_root(), "status_need_8tb": status().get("need_8tb")}, indent=2))
PY
