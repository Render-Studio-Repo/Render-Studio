from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path


def _load_sidecar():
    path = Path(__file__).resolve().parents[2] / "integrations" / "cursor-bridge" / "pty_sidecar.py"
    spec = importlib.util.spec_from_file_location("pty_sidecar", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(mod)
    return mod


class PtySidecarBindTests(unittest.TestCase):
    def test_refuses_non_loopback_without_flag(self) -> None:
        sidecar = _load_sidecar()
        self.assertEqual(sidecar.resolve_bind_host("127.0.0.1"), "127.0.0.1")
        self.assertEqual(sidecar.resolve_bind_host("localhost"), "127.0.0.1")
        with self.assertRaises(ValueError):
            sidecar.resolve_bind_host("0.0.0.0", allow_lan=False)
        with self.assertRaises(ValueError):
            sidecar.resolve_bind_host("192.168.1.83", allow_lan=False)
        self.assertEqual(sidecar.resolve_bind_host("0.0.0.0", allow_lan=True), "0.0.0.0")

    def test_cli_exits_2_without_lan_flag(self) -> None:
        sidecar = _load_sidecar()
        self.assertEqual(sidecar.main(["--host", "0.0.0.0"]), 2)

    def test_token_written_once_not_reread_as_new(self) -> None:
        sidecar = _load_sidecar()
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "pty-bridge.token"
            first, created = sidecar.load_or_create_token(dest)
            second, created_again = sidecar.load_or_create_token(dest)
            self.assertTrue(created)
            self.assertFalse(created_again)
            self.assertEqual(first, second)
            self.assertGreaterEqual(len(first), 16)
            self.assertEqual(dest.read_text(encoding="utf-8").strip(), first)

    def test_cors_allows_studio_origins_only(self) -> None:
        sidecar = _load_sidecar()
        self.assertTrue(sidecar.origin_allowed(None))
        self.assertTrue(sidecar.origin_allowed("https://render3d.app"))
        self.assertTrue(sidecar.origin_allowed("http://127.0.0.1:8001"))
        self.assertFalse(sidecar.origin_allowed("https://evil.example"))
