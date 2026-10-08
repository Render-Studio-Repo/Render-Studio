from __future__ import annotations

import subprocess
import tempfile
import unittest
import importlib.util
from pathlib import Path

AUDIT_PATH = Path(__file__).resolve().parents[1] / "public-release-audit.py"
SPEC = importlib.util.spec_from_file_location("public_release_audit", AUDIT_PATH)
assert SPEC and SPEC.loader
public_release_audit = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(public_release_audit)


class PublicReleaseAuditTests(unittest.TestCase):
    def make_repo(self, files: dict[str, str]) -> tuple[tempfile.TemporaryDirectory, Path]:
        temp = tempfile.TemporaryDirectory()
        root = Path(temp.name)
        subprocess.run(["git", "init", "-q"], cwd=root, check=True)
        for relative, content in files.items():
            path = root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
        subprocess.run(["git", "add", "-A"], cwd=root, check=True)
        return temp, root

    def test_clean_public_tree_passes(self) -> None:
        temp, root = self.make_repo({"README.md": "Render Studio public release\n"})
        self.addCleanup(temp.cleanup)
        self.assertEqual(public_release_audit.audit(root), [])

    def test_private_admin_markers_and_paths_are_blocked(self) -> None:
        temp, root = self.make_repo({
            "notes.txt": "Render-Studio-" "Admin-Control\n",
            "scripts/admin-private-backup.sh": "#!/bin/sh\n",
        })
        self.addCleanup(temp.cleanup)
        errors = public_release_audit.audit(root)
        self.assertIn("private admin repository marker: notes.txt", errors)
        self.assertIn("forbidden public path: scripts/admin-private-backup.sh", errors)

    def test_pre_push_runs_audit_before_feature_checks(self) -> None:
        hook = (Path(__file__).resolve().parents[1] / "git-hooks" / "pre-push").read_text(encoding="utf-8")
        self.assertLess(hook.index("public-release-audit.py"), hook.index("feature-map.mjs"))


if __name__ == "__main__":
    unittest.main()
