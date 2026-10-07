from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import marketplace_config_service


SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "bootstrap_render_instance.py"
SPEC = importlib.util.spec_from_file_location("bootstrap_render_instance", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class InstallBootstrapTests(unittest.TestCase):
    def test_secrets_are_created_once_and_preserved_on_rerun(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            env = Path(tmp) / ".env"
            env.write_text("JWT_SECRET=\nSECRETS_FERNET_KEY=\nPORT=8001\n", encoding="utf-8")
            MODULE.upsert_missing_env(env, {"JWT_SECRET": "first", "SECRETS_FERNET_KEY": "fernet"})
            first = env.read_text(encoding="utf-8")
            MODULE.upsert_missing_env(env, {"JWT_SECRET": "second", "SECRETS_FERNET_KEY": "changed"})
            self.assertEqual(env.read_text(encoding="utf-8"), first)
            self.assertIn("JWT_SECRET=first", first)
            self.assertIn("SECRETS_FERNET_KEY=fernet", first)
            self.assertEqual(env.stat().st_mode & 0o777, 0o600)

    def test_bootstrap_creates_one_stable_instance_id(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            env = root / ".env"
            with patch.object(marketplace_config_service.settings, "data_dir", str(root / "data")):
                first = MODULE.bootstrap(env)
                second = MODULE.bootstrap(env)
            self.assertTrue(first)
            self.assertEqual(second, first)
            self.assertIn("JWT_SECRET=", env.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
