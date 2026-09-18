from __future__ import annotations

import contextlib
import hashlib
import json
import os
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from unittest import mock

from PIL import Image

from backend.services import render_qa_service


def _png_bytes(width: int, height: int, color: tuple[int, int, int] = (120, 140, 160)) -> bytes:
    buf = BytesIO()
    Image.new("RGB", (width, height), color).save(buf, format="PNG")
    return buf.getvalue()


@contextlib.contextmanager
def _patched_sandbox(repo_root: Path):
    old = {
        "REPO_ROOT": render_qa_service.REPO_ROOT,
        "SANDBOX_ROOT": render_qa_service.SANDBOX_ROOT,
        "RECEIPTS_ROOT": render_qa_service.RECEIPTS_ROOT,
        "RECEIPT_EXAMPLES_ROOT": render_qa_service.RECEIPT_EXAMPLES_ROOT,
        "RENDER_QA_ROOT": render_qa_service.RENDER_QA_ROOT,
        "RENDER_QA_LOGS_ROOT": render_qa_service.RENDER_QA_LOGS_ROOT,
        "RENDER_QA_FAIL_PACKS_ROOT": render_qa_service.RENDER_QA_FAIL_PACKS_ROOT,
        "PM_CHART_FEED_PATH": render_qa_service.PM_CHART_FEED_PATH,
    }
    render_qa_service.REPO_ROOT = repo_root
    render_qa_service.SANDBOX_ROOT = repo_root / "sandbox-sessions"
    render_qa_service.RECEIPTS_ROOT = render_qa_service.SANDBOX_ROOT / "receipts"
    render_qa_service.RECEIPT_EXAMPLES_ROOT = render_qa_service.RECEIPTS_ROOT / "examples"
    render_qa_service.RENDER_QA_ROOT = render_qa_service.SANDBOX_ROOT / "render-qa"
    render_qa_service.RENDER_QA_LOGS_ROOT = render_qa_service.RENDER_QA_ROOT / "logs"
    render_qa_service.RENDER_QA_FAIL_PACKS_ROOT = render_qa_service.RENDER_QA_ROOT / "fail-packs"
    render_qa_service.PM_CHART_FEED_PATH = render_qa_service.RECEIPTS_ROOT / "pm-chart-feed.json"
    try:
        yield
    finally:
        for key, value in old.items():
            setattr(render_qa_service, key, value)


class RenderQaServiceTests(unittest.TestCase):
    def _project(self, root: Path, project_id: str) -> Path:
        project_path = root / "projects" / project_id
        project_path.mkdir(parents=True, exist_ok=True)
        (project_path / "project.json").write_text(
            json.dumps({"id": project_id, "name": f"Project {project_id}"}),
            encoding="utf-8",
        )
        (project_path / "renders").mkdir(exist_ok=True)
        return project_path

    def test_pm_chart_feed_is_empty_without_receipts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo_root = Path(tmp)
            with _patched_sandbox(repo_root):
                feed = render_qa_service._build_pm_chart_feed()
            self.assertEqual(feed["receipts"], [])

    def test_evaluate_render_passes_with_explicit_hash_upright_and_user_signal(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo_root = Path(tmp)
            project_path = self._project(repo_root, "demo-pass")
            source_path = project_path / "fixture.glb"
            source_path.write_bytes(b"glb-pass-fixture")
            (project_path / "fixture.step").write_bytes(b"step-pass-fixture")
            (project_path / "fixture.stl").write_bytes(b"stl-pass-fixture")
            (project_path / "layout.json").write_text(json.dumps({"units": "meters"}), encoding="utf-8")
            render_path = project_path / "renders" / "render_pass.png"
            render_path.write_bytes(_png_bytes(1024, 1024))
            request_bytes = _png_bytes(1600, 900)
            with _patched_sandbox(repo_root), contextlib.ExitStack() as stack:
                for key in render_qa_service.WORKSHOP_INGEST_ENV_KEYS:
                    stack.enter_context(mock.patch.dict(os.environ, {key: ""}))
                result = render_qa_service.evaluate_render(
                    project_path,
                    project_id="demo-pass",
                    render_filename="render_pass.png",
                    source_filename="fixture.glb",
                    prompt="Photoreal render on a studio desk",
                    kind="scene_render",
                    request_image_bytes=request_bytes,
                    log_id="log-pass-1",
                    trace_id="trace-pass-1",
                    user={"id": "u1", "display_name": "Tester", "email": "tester@example.com"},
                    source_up_axis="z",
                    user_signal="approved",
                )
                latest = json.loads((render_qa_service.RECEIPTS_ROOT / "latest.json").read_text(encoding="utf-8"))
                chart = json.loads(render_qa_service.PM_CHART_FEED_PATH.read_text(encoding="utf-8"))
            self.assertEqual(result["status"], "pass")
            self.assertIsNone(result["failure_id"])
            self.assertTrue(result["receipt_id"].startswith("RCPT-RENDER-"))
            self.assertEqual(latest["receipt_id"], result["receipt_id"])
            self.assertEqual(latest["payload"]["source"]["content_hash"], hashlib.sha256(b"glb-pass-fixture").hexdigest())
            self.assertEqual(latest["payload"]["export_metadata"]["layout"]["units"], "meters")
            self.assertEqual(chart["receipts"][0]["receipt_id"], result["receipt_id"])
            self.assertNotIn("score", chart["receipts"][0])
            gate_statuses = {gate["id"]: gate["status"] for gate in result["gates"]}
            self.assertEqual(gate_statuses, {"IDENTITY": "pass", "UPRIGHT": "pass", "FRAMING": "pass", "USER": "pass"})

    def test_evaluate_render_emits_fail_pack_when_gates_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo_root = Path(tmp)
            project_path = self._project(repo_root, "demo-fail")
            (project_path / "fixture.glb").write_bytes(b"glb-fail-fixture")
            render_path = project_path / "renders" / "render_fail.png"
            render_path.write_bytes(_png_bytes(1024, 1024))
            tiny_request = _png_bytes(1, 1)
            with _patched_sandbox(repo_root), contextlib.ExitStack() as stack:
                for key in render_qa_service.WORKSHOP_INGEST_ENV_KEYS:
                    stack.enter_context(mock.patch.dict(os.environ, {key: ""}))
                result = render_qa_service.evaluate_render(
                    project_path,
                    project_id="demo-fail",
                    render_filename="render_fail.png",
                    source_filename="fixture.glb",
                    prompt="Photoreal render outdoors",
                    kind="scene_render",
                    request_image_bytes=tiny_request,
                    log_id="log-fail-1",
                    trace_id="trace-fail-1",
                    user={"id": "u2", "display_name": "Tester", "email": "tester@example.com"},
                    source_up_axis=None,
                    user_signal=None,
                )
                latest = json.loads((render_qa_service.RECEIPTS_ROOT / "latest.json").read_text(encoding="utf-8"))
                failure_pack = json.loads(
                    (repo_root / result["failure_pack_path"]).read_text(encoding="utf-8")
                )
            self.assertEqual(result["status"], "fail")
            self.assertTrue(result["failure_id"].startswith("FAIL-RENDER-"))
            self.assertEqual(latest["failure_id"], result["failure_id"])
            failed_gates = {gate["id"] for gate in failure_pack["failed_gates"]}
            self.assertEqual(failure_pack["repair_loop"]["attempt_budget"], 3)
            self.assertIn("UPRIGHT", failed_gates)
            self.assertIn("FRAMING", failed_gates)
            self.assertIn("USER", failed_gates)


if __name__ == "__main__":
    unittest.main()
