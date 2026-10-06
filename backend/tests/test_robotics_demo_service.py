import json
from unittest.mock import patch

from backend.services import robotics_demo_service as service
from backend.services import robotics_dataset_service


class Response:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


def test_install_creates_streaming_profile_without_downloading_shards(tmp_path):
    simulation = tmp_path / "bundled-sim"
    (simulation / "cell").mkdir(parents=True)
    (simulation / "openarm_bimanual.xml").write_text("<mujoco/>")
    (simulation / "cell/demo.xml").write_text("<mujoco/>")
    responses = [
        Response({"sha": "abc123"}),
        Response([
            {"path": "meta/info.json", "size": 4000, "type": "file"},
            {"path": "data/chunk-000/file-000.parquet", "size": 4_000_000, "type": "file"},
            {"path": "videos/observation.images.head_left/chunk-000/file-000.mp4", "size": 20_000_000, "type": "file"},
        ]),
        Response({"sha": "policy456"}),
        Response([
            {"path": "config.json", "size": 1000, "type": "file"},
            {"path": "model.safetensors", "size": 80_000_000, "type": "file"},
        ]),
    ]
    with patch("backend.services.robotics_demo_service.httpx.get", side_effect=responses), patch.object(service, "SIMULATION_SOURCE", simulation):
        result = service.install(tmp_path)
    root = tmp_path / service.DEMO_ROOT
    profile = json.loads((root / "robotics-profile.json").read_text())
    receipt = json.loads((root / "install-receipt.json").read_text())
    assert result["demo"]["state"] == "ready"
    assert profile["dataset"]["storage"] == "hub_stream"
    assert profile["dataset"]["loader"].endswith("StreamingLeRobotDataset")
    assert profile["model"]["revision"] == "policy456"
    assert receipt["local_dataset_bytes"] == 0
    assert not (root / "dataset").exists()
    assert (tmp_path / service.TRAINING_DATA_ROOT / "remote-dataset.json").is_file()
    assert (tmp_path / service.POLICY_ROOT / "remote-policy.json").is_file()
    assert (tmp_path / service.SIMULATION_ROOT / "cell/demo.xml").is_file()
    assert (tmp_path / service.OPENARM_ROOT / "Demos/README.md").is_file()
    assert (tmp_path / "references/OpenArm Demo Sources.md").is_file()
    datasets = robotics_dataset_service.summary(tmp_path)["datasets"]
    assert datasets == [{
        "name": "OpenArm Cube Pick LeRobot",
        "root": service.TRAINING_DATA_ROOT.as_posix(),
        "files": 1,
        "bytes": (tmp_path / service.TRAINING_DATA_ROOT / "remote-dataset.json").stat().st_size,
        "remote_bytes": 24_004_000,
        "storage": "hub_stream",
        "episodes": 30,
        "videos": 5,
        "successes": 0,
        "failures": 0,
    }]
    (tmp_path / service.TRAINING_DATA_ROOT / "local-snapshot.json").write_text(json.dumps({
        "schema": "render3d.huggingface-snapshot.v1", "complete": True,
        "revision": "abc123", "bytes": 24_004_000,
    }))
    assert robotics_dataset_service.summary(tmp_path)["datasets"][0]["storage"] == "local_mirror"


def test_agent_created_project_profiles_are_discovered(tmp_path):
    root = tmp_path / "references/Robots/My Profile"
    root.mkdir(parents=True)
    (root / "robotics-profile.json").write_text(json.dumps({
        "schema": "render3d.robotics-demo.v1",
        "name": "My Profile",
        "dataset": {"root": "hf://datasets/example/demo@main"},
    }))
    out = service.list_profiles(tmp_path)
    assert out["profiles"][0]["name"] == "My Profile"
    assert out["profiles"][0]["root"] == "references/Robots/My Profile"


def test_save_profile_creates_explorer_visible_snapshot_and_keeps_existing_distinct(tmp_path):
    first = service.save_profile(
        tmp_path,
        name="Cube Run",
        settings={
            "dataset_root": "references/Robots/OpenArm 2.0/Training Data/Cubes",
            "config_url": "http://192.168.1.77:8450/robotics/config",
            "hardware_target": "http://192.168.1.77:8450/robotics/config",
            "start_position": "emote:take-006",
        },
    )
    second = service.save_profile(tmp_path, name="Cube Run", settings={"dataset_root": "new-data"})

    assert first["saved"]["root"] == "references/Robots/Saved Profiles/Cube-Run"
    assert second["saved"]["root"] == "references/Robots/Saved Profiles/Cube-Run-2"
    saved_file = tmp_path / first["saved"]["root"] / "robotics-profile.json"
    assert saved_file.is_file()
    payload = json.loads(saved_file.read_text())
    assert payload["schema"] == "render3d.robotics-home-profile.v1"
    assert payload["dataset"]["root"].endswith("Training Data/Cubes")
    assert payload["home"]["start_position"] == "emote:take-006"
    assert service.list_profiles(tmp_path)["profiles"][0]["root"] == second["saved"]["root"]
