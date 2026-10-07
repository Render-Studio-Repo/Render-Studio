"""Loopback-only local PTY gates for the in-viewport terminal."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from backend.services import local_pty


class _Conn(SimpleNamespace):
    pass


class LocalPtyGateTests(unittest.TestCase):
    def test_loopback_localhost_allowed(self) -> None:
        conn = _Conn(client=SimpleNamespace(host="127.0.0.1"))
        ok, reason = local_pty.local_terminal_gate(conn, "localhost:8001")
        self.assertTrue(ok)
        self.assertEqual(reason, "")

    def test_ipv6_loopback_allowed(self) -> None:
        conn = _Conn(client=SimpleNamespace(host="::1"))
        ok, _ = local_pty.local_terminal_gate(conn, "[::1]:8001")
        self.assertTrue(ok)

    def test_cloud_host_refused(self) -> None:
        conn = _Conn(client=SimpleNamespace(host="127.0.0.1"))
        ok, reason = local_pty.local_terminal_gate(conn, "render3d.app")
        self.assertFalse(ok)
        self.assertIn("8765", reason)

    def test_lan_peer_refused(self) -> None:
        conn = _Conn(client=SimpleNamespace(host="192.168.1.50"))
        ok, reason = local_pty.local_terminal_gate(conn, "192.168.1.50:8001")
        self.assertFalse(ok)
        self.assertEqual(reason, local_pty.REMOTE_UNAVAILABLE)

    def test_forwarded_header_is_ignored(self) -> None:
        conn = _Conn(
            client=SimpleNamespace(host="8.8.8.8"),
            headers={"x-forwarded-for": "127.0.0.1", "host": "localhost:8001"},
        )
        ok, _ = local_pty.local_terminal_gate(conn, "localhost:8001")
        self.assertFalse(ok)

    def test_cwd_uses_project_then_home(self) -> None:
        home = Path.home()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "proj-a").mkdir()
            self.assertEqual(local_pty.resolve_pty_cwd("proj-a", root=root), (root / "proj-a").resolve())
            self.assertEqual(local_pty.resolve_pty_cwd("", root=root), home)
            self.assertEqual(local_pty.resolve_pty_cwd("../etc", root=root), home)
            self.assertEqual(local_pty.resolve_pty_cwd("missing", root=root), home)

    def test_shell_prefers_env_then_zsh_on_darwin(self) -> None:
        with patch.dict("os.environ", {"SHELL": "/bin/sh"}, clear=False), patch(
            "backend.services.local_pty.sys.platform", "darwin"
        ):
            self.assertEqual(local_pty.resolve_shell(), "/bin/sh")
        with patch.dict("os.environ", {"SHELL": ""}, clear=False), patch(
            "backend.services.local_pty.sys.platform", "darwin"
        ), patch("backend.services.local_pty.Path.is_file", return_value=True), patch(
            "backend.services.local_pty.os.access", return_value=True
        ):
            self.assertEqual(local_pty.resolve_shell(), "/bin/zsh")


if __name__ == "__main__":
    unittest.main()
