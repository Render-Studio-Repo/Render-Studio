import json
from backend.services import robotics_policy_evaluation as subject


def test_start_rejects_scene_outside_bundle():
    try:
        subject.start("u1", {"checkpoint": subject.CHECKPOINT, "scene": "../outside.xml"})
    except ValueError as exc:
        assert "bundled MuJoCo XML scene" in str(exc)
    else:
        raise AssertionError("unapproved scene was accepted")


def test_run_uses_fixed_adapter_scene_and_checkpoint(monkeypatch, tmp_path):
    output = tmp_path / "result.json"
    output.write_text(json.dumps({"success": False, "reason": "timeout_before_cube_lift"}))
    monkeypatch.setattr(subject, "OUTPUT", output)
    monkeypatch.setattr(subject, "TRAJECTORY", tmp_path / "result.trajectory.json")
    seen = {}

    class FakeProcess:
        stdout = iter([
            json.dumps({"kind": "trajectory_frame", "step": 1, "sim_seconds": 0.033, "qpos": [0.0, 0.1]}) + "\n",
            "-0.045\n",
        ])

        @staticmethod
        def wait():
            return 2

        @staticmethod
        def kill():
            return None

    def fake_popen(command, **kwargs):
        seen["command"] = command
        return FakeProcess()

    monkeypatch.setattr(subject.subprocess, "Popen", fake_popen)
    subject._jobs["u2"] = {"status": "running", "scene": "cell/demo.xml", "checkpoint": subject.CHECKPOINT, "revision": subject.REVISION, "evaluationId": "eval-2"}
    subject._run("u2", "eval-2")
    job = subject.status("u2")
    assert job["status"] == "completed"
    assert job["result"]["success"] is False
    assert job["simulationPassed"] is False
    assert job["hardwareValidated"] is False
    assert len(job["hardwareBlockers"]) == 3
    assert job["exitCode"] == 2
    assert seen["command"][seen["command"].index("--scene") + 1] == str(subject.SCENE)
    assert seen["command"][seen["command"].index("--checkpoint") + 1] == subject.CHECKPOINT


def test_start_binds_exact_scene_and_requires_stop_before_switch(monkeypatch):
    monkeypatch.setattr(subject.threading.Thread, "start", lambda self: None)
    subject._jobs.pop("scene-user", None)
    first = subject.start("scene-user", {"checkpoint": "owner/act-one", "scene": "cell/demo.xml"})
    assert first["scene"] == "cell/demo.xml"
    try:
        subject.start("scene-user", {"checkpoint": "owner/act-two", "scene": "cell/tool_cell_scene.xml"})
    except ValueError as exc:
        assert "Stop the active evaluation" in str(exc)
    else:
        raise AssertionError("scene switch reused a running evaluation")
    stopped = subject.stop("scene-user")
    assert stopped["status"] == "stopped"
    second = subject.start("scene-user", {"checkpoint": "owner/act-two", "scene": "cell/tool_cell_scene.xml"})
    assert second["scene"] == "cell/tool_cell_scene.xml"
    assert second["evaluationId"] != first["evaluationId"]


def test_cube_checkpoint_rejects_incompatible_scene():
    try:
        subject.start("mismatch-user", {"checkpoint": subject.CHECKPOINT, "scene": "pedestal/catch_scene.xml"})
    except ValueError as exc:
        assert "trained for cell/demo.xml" in str(exc)
    else:
        raise AssertionError("cube checkpoint ran against an incompatible scene")
