"""VibeCAD sidecar preserves authored geometry and rejects failed kernels."""

from __future__ import annotations

import tempfile
import unittest
import math
import importlib.util
from pathlib import Path
from unittest.mock import patch


TORUS_FUSE = """
from build123d import *
A = (Align.CENTER, Align.CENTER, Align.MIN)
cx = 114
rf = 2.0
def cyl(x, y, z, r, h):
    return Pos(x, y, z) * Cylinder(r, h, align=A)
def rounded(x, y, z, a, b, c, r=rf):
    p = Box(a, b, c, align=A)
    return Pos(x, y, z) * fillet(p.edges().filter_by(Axis.Z), r)
cup = cyl(cx, 0, -44, 26, 54) - cyl(cx, 0, -40, 22, 56)
cup -= rounded(cx, -25, -39, 16, 22, 55)
rim = Pos(cx, 0, 10) * Torus(24, rf)
rim -= rounded(cx, -25, -39, 16, 22, 55)
cup += rim
result = {"cup": cup}
"""

HELIX_THREAD = """
from build123d import *
A = (Align.CENTER, Align.CENTER, Align.MIN)
section = Plane.XZ * Polygon((8, -1), (10, -0.5), (10, 0.5), (8, 1), align=None)
ridge = sweep(section, path=Helix(4, 84, 8), is_frenet=True)
screw = Cylinder(8, 80, align=A)
screw += Pos(0, 0, -2) * ridge
result = {"screw": screw}
"""


class WorkerOccGuardTests(unittest.TestCase):
    def _compile(self, source: str, expected: list[str]) -> dict:
        from backend.services.vibecad_service import _run_worker

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            result = _run_worker(
                project_path=root,
                stem="guard",
                source=source,
                parameters={},
                expected_outputs=expected,
                timeout_sec=45.0,
            )
            outputs = result.get("outputs") or []
            result["_step_exists"] = bool(
                outputs and Path(str(outputs[0].get("step_path") or "")).is_file()
            )
            return result

    def test_torus_preserves_circular_section_and_partial_angle(self) -> None:
        for angle in (360, 180):
            with self.subTest(angle=angle):
                result = self._compile(
                    f"from build123d import *\nresult = {{'ring': Torus(10, 2, major_angle={angle})}}\n",
                    ["ring"],
                )
                self.assertTrue(result.get("ok"), result.get("error"))
                self.assertAlmostEqual(
                    result["outputs"][0]["shape"]["volume_mm3"],
                    2 * math.pi**2 * 10 * 2**2 * angle / 360,
                    places=4,
                )

    def test_worker_reports_actual_kernel_runtime_on_success_and_failure(self) -> None:
        for source in ("from build123d import *\nresult = {'body': Box(1,2,3)}", "raise RuntimeError('intentional')"):
            result = self._compile(source, ["body"])
            runtime = result["runtime_provenance"]
            self.assertTrue(runtime["python_version"])
            self.assertTrue(runtime["python_executable"])
            self.assertTrue(runtime["build123d_version"])
            self.assertTrue(runtime["ocp_version"])

    def test_torus_fused_onto_cup_produces_step(self) -> None:
        result = self._compile(TORUS_FUSE, ["cup"])
        self.assertTrue(result.get("ok"), result.get("error"))
        self.assertTrue(result.get("_step_exists"))
        self.assertEqual(len(result.get("outputs") or []), 1)

    def test_invalid_helix_thread_is_rejected_without_cylinder_substitution(self) -> None:
        result = self._compile(HELIX_THREAD, ["screw"])
        self.assertFalse(result.get("ok"))
        self.assertIn("not a valid shape", result["error"])
        self.assertFalse(result.get("_step_exists"))

    def test_valid_helix_sweep_preserves_tube_volume(self) -> None:
        result = self._compile(
            "from build123d import *\n"
            "profile = Plane.XZ * Pos(8, 0) * Circle(0.5)\n"
            "result = {'spring': sweep(profile, path=Helix(4, 8, 8), is_frenet=True)}\n",
            ["spring"],
        )
        self.assertTrue(result.get("ok"), result.get("error"))
        # The profile remains vertical, so volume uses the horizontal path length.
        expected = math.pi * 0.5**2 * (2 * math.pi * 8 * 2)
        self.assertAlmostEqual(result["outputs"][0]["shape"]["volume_mm3"], expected, delta=0.001)

    def test_supplied_params_and_srgb_build_colored_part(self) -> None:
        result = self._compile(
            "from build123d import *\n"
            "p = {'width': 10}\np.update(params)\n"
            "part = Box(p['width'], 20, 3)\n"
            "part.color = srgb('#8a939d')\n"
            "result = {'deck': part}\n",
            ["deck"],
        )
        self.assertTrue(result.get("ok"), result.get("error"))
        self.assertTrue(result.get("_step_exists"))

    def test_valid_single_solid_uses_plain_step_writer_when_xcaf_rejects_it(self) -> None:
        from build123d import Box, import_step

        worker_path = (
            Path(__file__).parents[1]
            / "skills/vibecad/scripts/build123d_worker.py"
        )
        spec = importlib.util.spec_from_file_location(
            "vibecad_worker_step_fallback_test", worker_path
        )
        worker = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(worker)

        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "fallback.step"
            with patch(
                "build123d.exporters3d.export_step",
                side_effect=RuntimeError("Failed to write STEP file"),
            ):
                worker._export_step_geometry(Box(10, 20, 30), output)

            restored = import_step(str(output))
            self.assertTrue(restored.is_valid)
            self.assertEqual(len(restored.solids()), 1)
            self.assertAlmostEqual(restored.volume, 6000.0, places=5)

    def test_invalid_solid_is_rejected_before_step_export(self) -> None:
        result = self._compile(
            "from build123d import *\n"
            "result = {'broken': Solid(Shell(Face.make_rect(10, 10)))}\n",
            ["broken"],
        )
        self.assertFalse(result["ok"])
        self.assertIn("not a valid shape", result["error"])
        self.assertFalse(result["_step_exists"])

    def test_reports_every_disconnected_output_in_one_compile(self) -> None:
        result = self._compile(
            "from build123d import *\n"
            "a = Box(10, 10, 2) + Pos(20, 0, 0) * Box(10, 10, 2)\n"
            "b = Cylinder(3, 4) + Pos(12, 0, 0) * Cylinder(3, 4)\n"
            "result = {'wire_home': a, 'wire_limit': b}\n",
            ["wire_home", "wire_limit"],
        )
        self.assertFalse(result["ok"])
        self.assertIn("result['wire_home'] must contain exactly one solid; received 2", result["error"])
        self.assertIn("result['wire_limit'] must contain exactly one solid; received 2", result["error"])

    def test_overlapping_named_assembly_round_trips_when_each_solid_is_valid(self) -> None:
        names = [f"part_{index:03d}" for index in range(121)]
        source = (
            "from build123d import *\n"
            "result = {}\n"
            "for index in range(121):\n"
            "    result['part_%03d' % index] = Box(10, 10, 10)\n"
        )

        result = self._compile(source, names)

        self.assertTrue(result["ok"], result.get("error"))
        self.assertEqual(result["outputs"][0]["shape"]["solid_count"], 121)

    def test_cadgen_import_remains_blocked(self) -> None:
        result = self._compile("import cadgen\nresult = {}\n", [])
        self.assertFalse(result.get("ok"))
        self.assertIn("Import is not allowed in build123d source: cadgen", result.get("error", ""))


if __name__ == "__main__":
    unittest.main()


class ScallopedOffsetRegressionTests(unittest.TestCase):
    _compile = WorkerOccGuardTests._compile

    def test_failed_lip_offset_keeps_diagnostics_and_smooth_profile_builds(self):
        source = (Path(__file__).parent / "fixtures/vibecad_scallop_offset.py").read_text()
        failed = self._compile(source, ["rim"])
        self.assertFalse(failed["ok"])
        self.assertIn("BRep_API: command not done", failed["error"])
        evidence = failed["exception_evidence"]
        self.assertIn("exception_chain", evidence)
        self.assertNotIn("diagnostic_error", evidence)
        frames = [f for exc in evidence["exception_chain"] for f in exc["frames"]]
        self.assertTrue(any(f["function"] == "inset" for f in frames))
        smooth = source.replace("inset(F, rim + p['lip_gap'])", "inset(S, rim + p['lip_gap'])")
        # OCC accepts this offset solid, but its STEP round trip becomes a shell.
        # The host must reject that loss rather than publishing a partial model.
        lost = self._compile(smooth, ["rim"])
        self.assertFalse(lost["ok"])
        self.assertIn("STEP round-trip validation failed", lost["error"])
        repaired = smooth.replace(
            "return offset(face, amount=-amount, kind=Kind.ARC).faces()[0]",
            "return offset(face, amount=-amount, kind=Kind.ARC).faces()[0].to_splines(tolerance=0.001)",
        )
        fixed = self._compile(repaired, ["rim"])
        self.assertTrue(fixed["ok"], fixed.get("error"))
        self.assertTrue(fixed["_step_exists"])
        self.assertTrue(fixed["outputs"][0]["shape"]["valid"])
        self.assertEqual(fixed["outputs"][0]["shape"]["solid_count"], 1)
