"""Verify installed Codex sends the selected fake key only to a localhost probe."""

from __future__ import annotations

import http.server
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from backend.services.cad_host_runtime import resolve_codex_launch
from backend.services.codex_agent import resolve_codex_bin
from backend.services.codex_launch_env import codex_launch_env


class Probe(http.server.BaseHTTPRequestHandler):
    headers_seen = []

    def do_POST(self):
        self.headers_seen.append(self.headers.get("Authorization"))
        self.send_response(401)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"error":{"message":"synthetic local auth probe"}}')

    def log_message(self, *_args):
        pass


def main():
    binary = resolve_codex_bin()
    assert binary, "Installed Codex is required"
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Probe)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with tempfile.TemporaryDirectory(prefix="r3d-auth-probe-") as work:
            ai = SimpleNamespace(provider="openai", api_key="fake-local-only", model="gpt-6-astra")
            with patch("backend.services.cad_host_runtime._chatgpt_home", return_value=None), \
                 patch("backend.services.cad_host_runtime._api_key_home", return_value=Path(work)):
                launch = resolve_codex_launch(ai, user_id="synthetic-recipient")
            config = [
                'model_provider="localprobe"',
                'model_providers.localprobe.name="Local probe"',
                f'model_providers.localprobe.base_url="http://127.0.0.1:{server.server_port}/v1"',
                'model_providers.localprobe.wire_api="responses"',
                'model_providers.localprobe.requires_openai_auth=true',
                'model_providers.localprobe.request_max_retries=0',
                'model_providers.localprobe.stream_max_retries=0',
            ]
            cmd = [str(binary), "exec", "--skip-git-repo-check", "--ephemeral", "--json", "-C", work, "-m", launch.cli_model]
            for value in config:
                cmd.extend(["-c", value])
            cmd.append("Reply OK")
            for label, env in (
                ("legacy_OPENAI_API_KEY", {"CODEX_HOME": work, "OPENAI_API_KEY": "fake-local-only"}),
                ("selected_launch", launch.env),
            ):
                Probe.headers_seen = []
                inherited = {**os.environ, "CODEX_API_KEY": "fake-host-key", "CODEX_ACCESS_TOKEN": "fake-host-access"}
                subprocess.run(cmd, env=codex_launch_env(env, inherited=inherited), capture_output=True, text=True, timeout=15)
                expected = None if label == "legacy_OPENAI_API_KEY" else "Bearer fake-local-only"
                assert Probe.headers_seen == [expected], f"{label}: unexpected local auth headers"
                print(json.dumps({"case": label, "authorization": expected, "result": "PASS"}))
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


if __name__ == "__main__":
    main()
