import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import imagine_service as svc


class ImagineServiceTests(unittest.TestCase):
    def test_folder_and_prompt_filename(self) -> None:
        self.assertEqual(svc.IMAGINE_DIRNAME, "imagine")
        name = svc.filename_from_prompt("Open Arm 2.0 concept!", suffix="ab12cd")
        self.assertEqual(name, "open-arm-2-0-concept-ab12cd.png")
        self.assertTrue(svc.is_imagine_rel("imagine/open-arm-ab12cd.png"))
        self.assertFalse(svc.is_imagine_rel("renders/x.png"))

    def test_fetch_formats_from_query(self) -> None:
        self.assertEqual(
            svc.formats_from_query("open arm 2.0 3d step model"),
            {"stl": False, "glb": False, "step": True, "3mf": False},
        )
        self.assertEqual(
            svc.formats_from_query("robot arm"),
            {"stl": True, "glb": True, "step": True, "3mf": False},
        )
        self.assertFalse(svc.suffix_allowed(".stl", {"stl": False, "glb": True, "step": True, "3mf": False}))
        self.assertTrue(svc.suffix_allowed(".step", {"stl": False, "glb": False, "step": True, "3mf": False}))

    def test_fetch_uses_step_parts_and_respects_format_checkbox(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            candidate = {
                "is_real_result": True,
                "name": "Open Arm 2.0",
                "step_url": "https://example.com/openarm.step",
                "glb_url": "https://example.com/openarm.glb",
            }

            def fake_download(url, dest, timeout=60.0):
                dest.write_bytes(b"CAD")

            with patch.object(svc.part_profiles_service, "search_sources", return_value=[candidate]), patch.object(
                svc.part_profiles_service, "download_asset", side_effect=fake_download
            ):
                data = svc.fetch_public_models(root, "open arm 2.0", {"stl": False, "glb": False, "step": True, "3mf": False})
            self.assertEqual(len(data["files"]), 1)
            self.assertTrue(data["files"][0]["name"].startswith("imagine/fetched/"))
            self.assertTrue(data["files"][0]["name"].endswith(".step"))
            self.assertIn("step.parts", data["sources"])
            self.assertFalse(any(f["name"].endswith(".glb") for f in data["files"]))

    def test_fetch_refuses_executables_and_private_hosts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with patch.object(svc.part_profiles_service, "search_sources", return_value=[]):
                data = svc.fetch_public_models(
                    root,
                    "https://127.0.0.1/evil.exe",
                    {"stl": True, "glb": True, "step": True, "3mf": False},
                )
            self.assertEqual(data["files"], [])
            self.assertTrue(data["message"])

    def test_rename_label_and_list_includes_prompt(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            item = svc.write_imagine_image(root, b"PNG", "matte black kettle", index=0)
            self.assertTrue(item["name"].startswith("imagine/"))
            self.assertEqual(item["prompt"], "matte black kettle")
            renamed = svc.rename_imagine_label(root, item["name"], "Kettle concept")
            self.assertEqual(renamed["label"], "Kettle concept")
            listed = svc.list_imagine_files(root)
            self.assertEqual(len(listed), 1)
            self.assertEqual(listed[0]["label"], "Kettle concept")
            self.assertEqual(listed[0]["prompt"], "matte black kettle")
            self.assertIn("original_prompt", listed[0])
            self.assertFalse(any(row["name"].endswith(".imagine.json") for row in listed))

    def test_reference_prompt_block_links_files(self) -> None:
        block = svc.reference_prompt_block(
            [
                {"token": "@kettle", "name": "kettle.png", "type": "image"},
                {"token": "@spec", "name": "spec.pdf", "type": "document", "text": "wall 2mm"},
            ]
        )
        self.assertIn("Attached as reference:", block)
        self.assertIn("@kettle: image kettle.png", block)
        self.assertIn("@spec: document spec.pdf", block)
        self.assertIn("wall 2mm", block)
        self.assertEqual(svc.reference_prompt_block([]), "")
        self.assertEqual(svc.reference_prompt_block(None), "")

    def test_imagine_endpoint_does_not_append_reference_banner_to_prompt(self) -> None:
        from pathlib import Path
        import inspect
        from backend import main as studio_main

        src = inspect.getsource(studio_main.create_imagine_images)
        self.assertNotIn("reference_prompt_block", src)
        self.assertNotIn("[Reference:", src)
        html = (Path(__file__).resolve().parents[2] / "frontend" / "index.html").read_text(encoding="utf-8")
        self.assertIn("filelink1", html)


if __name__ == "__main__":
    unittest.main()
