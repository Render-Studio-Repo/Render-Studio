import ast
import os
from pathlib import Path
import tempfile
import time
import unittest

from backend.services.codex_agent import CodexFailed, _pick_artifacts


class EditArtifactTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.started = time.time()

    def write_model(self, stem, fresh=()):
        for ext, content in (("py", "def gen_step(): pass"), ("step", "STEP"), ("glb", "GLB")):
            path = self.root / f"{stem}.{ext}"
            path.write_text(content)
            stamp = self.started + 1 if ext in fresh else self.started - 3600
            os.utime(path, (stamp, stamp))

    def pick(self):
        return _pick_artifacts(self.root, "selected", min_mtime=self.started, require_fresh=True, preferred_only=True)

    def test_inspection_only_cannot_publish_existing_model(self):
        self.write_model("selected")
        with self.assertRaises(CodexFailed):
            self.pick()

    def test_changed_source_without_exports_is_not_a_finished_edit(self):
        self.write_model("selected", fresh=("py",))
        with self.assertRaises(CodexFailed):
            self.pick()

    def test_fresh_step_with_stale_viewport_glb_is_rejected(self):
        self.write_model("selected", fresh=("py", "step"))
        with self.assertRaises(CodexFailed):
            self.pick()

    def test_unrelated_new_part_cannot_replace_selection(self):
        self.write_model("selected")
        self.write_model("new_feature", fresh=("py", "step", "glb"))
        with self.assertRaises(CodexFailed):
            self.pick()

    def test_same_filename_with_fresh_exports_is_valid(self):
        self.write_model("selected", fresh=("step", "glb"))
        self.assertEqual(self.pick()["base"], "selected")

    def test_hidden_glb_export_can_supply_fresh_preview(self):
        self.write_model("selected", fresh=("step", "glb"))
        (self.root / "selected.glb").rename(self.root / ".selected.step.glb")
        self.assertEqual(self.pick()["glb"], "selected.glb")

    def test_fresh_hidden_glb_replaces_stale_preview(self):
        self.write_model("selected", fresh=("step",))
        hidden = self.root / ".selected.step.glb"
        hidden.write_text("NEW GLB")
        os.utime(hidden, (self.started + 1, self.started + 1))
        self.assertEqual(self.pick()["glb"], "selected.glb")
        self.assertEqual((self.root / "selected.glb").read_text(), "NEW GLB")

    def test_history_keeps_edit_coordinate_frames(self):
        # Exercise the serializer without importing the unrelated CAD runtime.
        path = Path(__file__).parents[1] / "services" / "prompt_history_service.py"
        tree = ast.parse(path.read_text())
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "_safe_history_references")
        scope = {"Any": object}
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(path), "exec"), scope)

        context = {"version": 1, "point_source": [1, 2, 3], "matrix_layout": "column-major"}
        refs = scope["_safe_history_references"]([{"id": "face-1", "geometry_context": context}])
        self.assertEqual(refs[0]["geometry_context"], context)


if __name__ == "__main__":
    unittest.main()
