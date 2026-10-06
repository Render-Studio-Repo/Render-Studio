from pathlib import Path

import pytest

from backend.services.robot_artifacts_service import RobotArtifactSource, validate_direct_source


class FakeRunner:
    def __init__(self, ok=True):
        self.ok = ok
        self.calls = []

    def run_skill_tool(self, skill, tool, args, **kwargs):
        self.calls.append((skill, tool, args, kwargs))
        return {"ok": self.ok, "exit_code": 0 if self.ok else 1, "stdout": '{"ok":true}', "stderr": ""}


def test_direct_urdf_pairs_and_validates_both_files(tmp_path: Path):
    (tmp_path / "arm.urdf").write_text("<robot name='arm'/>")
    (tmp_path / "arm.srdf").write_text("<robot name='arm'/>")
    source = RobotArtifactSource.resolve(tmp_path, "../arm.urdf")
    runner = FakeRunner()

    result = validate_direct_source(source, "both", skill_runner=runner)

    assert source.mode == "direct-xml"
    assert [call[:3] for call in runner.calls] == [
        ("urdf", "validate", ["arm.urdf", "--format", "json"]),
        ("srdf", "validate", ["arm.srdf", "--format", "json"]),
    ]
    assert [item["filename"] for item in result["outputs"]] == ["arm.urdf", "arm.srdf"]


def test_direct_srdf_requires_colocated_urdf(tmp_path: Path):
    (tmp_path / "arm.srdf").write_text("<robot name='arm'/>")
    with pytest.raises(FileNotFoundError, match="Paired URDF"):
        RobotArtifactSource.resolve(tmp_path, "arm.srdf")


def test_legacy_python_remains_supported(tmp_path: Path):
    (tmp_path / "arm.py").write_text("def gen_urdf(): pass\n")
    source = RobotArtifactSource.resolve(tmp_path, "arm.py")
    assert source.mode == "legacy-python"
    assert source.validation_targets("both") == ()
