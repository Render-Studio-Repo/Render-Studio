import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import robotics_dataset_catalog_service as service


class _Response:
    headers = {"content-length": "4"}

    def raise_for_status(self):
        return None

    def iter_bytes(self):
        yield b"data"


class _Stream:
    def __enter__(self):
        return _Response()

    def __exit__(self, *_args):
        return False


class RobotDatasetProjectStorageTests(unittest.TestCase):
    def test_confirmed_asset_can_be_saved_under_a_scoped_project_folder(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(service.httpx, "stream", return_value=_Stream()):
            root = Path(temp) / "references" / "Robots" / "OpenArm 2.0" / "Robot Models"
            result = service.retrieve_dataset_file("openarm/demo", "models/openarm.urdf", destination_root=root)
            self.assertEqual(result["destination"], "openarm/demo/models/openarm.urdf")
            self.assertEqual((root / result["destination"]).read_bytes(), b"data")

    def test_robot_asset_suffixes_include_models_and_policy_weights(self):
        self.assertEqual(service._safe_filename("meshes/gripper.glb"), "meshes/gripper.glb")
        self.assertEqual(service._safe_filename("policy/act.safetensors"), "policy/act.safetensors")


if __name__ == "__main__":
    unittest.main()
