import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest

class WorkerMaterialsTest(unittest.TestCase):
    def test_opaque_authored_color_survives_worker(self):
        path = Path(__file__).parents[1] / 'skills/vibecad/scripts/build123d_worker.py'
        spec = importlib.util.spec_from_file_location('worker_material_test', path)
        worker = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(worker)
        color = SimpleNamespace(to_tuple=lambda: (0.3, 0.2, 0.1, 1.0))
        shape = SimpleNamespace(color=color)
        worker._apply_workbench_color(shape, 5, lambda *args: args)
        self.assertIs(shape.color, color)
        unknown1, unknown2 = SimpleNamespace(color=None), SimpleNamespace(color=None)
        worker._apply_workbench_color(unknown1, 0, lambda *args: args)
        worker._apply_workbench_color(unknown2, 8, lambda *args: args)
        self.assertEqual(unknown1.color, unknown2.color)
