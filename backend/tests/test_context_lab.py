"""Context Lab: machines, notes, custom Improve, Improve Lab slots, Drive URL."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.database import get_conn, init_db
from backend.services import context_lab_service as lab


class ContextLabTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "t.db"
        self.db_patch = patch("backend.database.DB_PATH", self.db)
        self.db_patch.start()
        init_db()
        with get_conn() as conn:
            conn.execute(
                "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,?)",
                ("sam", "sam@example.com", "Sam", "x", "2026-09-07T00:00:00+00:00"),
            )

    def tearDown(self) -> None:
        self.db_patch.stop()
        self.tmp.cleanup()

    def test_catalog_has_popular_machines(self) -> None:
        ids = {row["id"] for row in lab.catalog()}
        self.assertIn("prusa-mk4", ids)
        self.assertIn("bambu-x1c", ids)
        self.assertIn("haas-vf2", ids)
        self.assertIn("glowforge-pro", ids)
        self.assertTrue(any(row["kind"] == "sheet_metal" for row in lab.catalog()))
        p1s = next(row for row in lab.catalog() if row["id"] == "bambu-p1s")
        self.assertEqual(p1s["image_url"], "/machine-thumbs/bambu-p1s.png")
        self.assertEqual(p1s["orca_model"], "Bambu Lab P1S")
        self.assertEqual(p1s["fit_clearances"]["sliding_mm"], 0.2)
        self.assertTrue(all(row.get("image_url", "").startswith("/machine-thumbs/") for row in lab.catalog()))

    def test_save_catalog_and_custom_machine(self) -> None:
        saved = lab.save_profile("sam", catalog_id="prusa-mk4")
        self.assertEqual(saved["brand"], "Prusa")
        self.assertTrue(saved["is_active"])
        self.assertEqual(saved["specs"]["nozzle_mm"], 0.4)
        custom = lab.save_profile(
            "sam",
            kind="laser_cutter",
            brand="Shop",
            model="K40",
            specs={"bed_mm": [200, 300], "kerf_mm": 0.25},
        )
        self.assertEqual(custom["model"], "K40")
        self.assertTrue(custom["is_active"])
        self.assertFalse(lab.active_profile("sam")["id"] == saved["id"])
        listed = lab.list_profiles("sam")
        self.assertEqual(len(listed), 2)
        self.assertTrue(any(row["id"] == custom["id"] for row in listed))
        snap = lab.snapshot("sam")
        self.assertEqual(len(snap["profiles"]), 2)
        self.assertEqual(snap["active_profile"]["id"], custom["id"])

    def test_save_and_list_customers(self) -> None:
        with self.assertRaises(ValueError):
            lab.save_customer("sam", name="  ")
        saved = lab.save_customer(
            "sam",
            name="Acme Robotics",
            company="Acme",
            notes="Prefer PETG, no visible screws, 0.4 mm nozzle shop.",
        )
        self.assertTrue(saved["is_active"])
        self.assertEqual(saved["name"], "Acme Robotics")
        again = lab.save_customer("sam", name="Beta Labs", notes="Aluminum only.", activate=True)
        self.assertTrue(again["is_active"])
        listed = lab.list_customers("sam")
        self.assertEqual(len(listed), 2)
        self.assertEqual(lab.active_customer("sam")["id"], again["id"])
        snap = lab.snapshot("sam")
        self.assertEqual(len(snap["customers"]), 2)
        self.assertEqual(snap["active_customer"]["name"], "Beta Labs")
        ctx = lab.improve_context("sam")
        self.assertIn("Beta Labs", ctx["block"])
        self.assertIn("Aluminum only", ctx["block"])
        lab.delete_customer("sam", again["id"])
        self.assertEqual(len(lab.list_customers("sam")), 1)

    def test_notes_and_settings_feed_improve_block(self) -> None:
        lab.save_profile("sam", catalog_id="bambu-p1s")
        lab.save_settings("sam", {"no_supports": True, "no_screws": True})
        folder = lab.save_note_folder("sam", name="Print rules")
        lab.save_note(
            "sam",
            folder_id=folder["id"],
            name="Walls",
            body="Keep walls ≥ 1.6 mm.",
            use_improve=True,
        )
        off = lab.save_note("sam", folder_id=folder["id"], name="Secret", body="Ignore me", use_improve=False)
        ctx = lab.improve_context("sam")
        self.assertIn("Bambu", ctx["block"])
        self.assertIn("don't need supports", ctx["block"].lower().replace("’", "'"))
        self.assertIn("1.6 mm", ctx["block"])
        self.assertNotIn("Ignore me", ctx["block"])
        self.assertTrue(ctx["uses_builtin_improve"])
        self.assertTrue(off["id"])

    def test_fdm_split_to_bed_default_on_and_prompt_rules(self) -> None:
        lab.save_profile("sam", catalog_id="bambu-p1s")
        ctx = lab.improve_context("sam")
        block = ctx["block"]
        self.assertIn("Split to fit plate", block)
        self.assertIn("256", block)
        self.assertIn("named printable sub-parts", block.lower())
        self.assertIn("alignment", block.lower())
        self.assertTrue(ctx["settings"]["toggles"].get("split_to_bed"))
        lab.save_settings("sam", {"split_to_bed": False, "no_screws": True})
        off = lab.improve_context("sam")
        self.assertNotIn("Split to fit plate", off["block"])
        self.assertNotIn("named printable sub-parts", off["block"].lower())
        lab.save_settings("sam", {"split_to_bed": True, "no_screws": True, "simplify_print": True})
        joined = lab.improve_context("sam")
        text = joined["block"].lower()
        self.assertIn("split to fit plate", text)
        self.assertIn("glue", text)
        self.assertIn("do not use screws", text)
        self.assertNotIn("join with glue, screws", text)
        self.assertIn("fitting the plate wins", text)
        lab.save_settings("sam", {"split_to_bed": True, "print_in_place": True})
        pip = lab.improve_context("sam")["block"].lower()
        self.assertIn("print-in-place", pip)
        self.assertIn("still split", pip)

    def test_printer_tolerance_toggle_feeds_improve_and_defaults_off(self) -> None:
        saved = lab.save_profile("sam", catalog_id="bambu-p1s")
        self.assertFalse(saved["printer_tolerance"])
        off = lab.improve_context("sam")
        self.assertNotIn("Printer fit tolerance", off["block"])
        self.assertNotIn("zero-clearance mates", off["block"])
        lab.save_profile(
            "sam",
            profile_id=saved["id"],
            catalog_id="bambu-p1s",
            specs={**(saved.get("specs") or {}), "printer_tolerance": True},
        )
        on = lab.improve_context("sam")
        self.assertIn("Printer fit tolerance", on["block"])
        self.assertIn("Bambu Lab P1S", on["block"])
        self.assertIn("0.20 mm", on["block"])
        self.assertIn("zero-clearance mates", on["block"])
        self.assertIn("screw bosses", on["block"])
        lab.save_profile(
            "sam",
            profile_id=saved["id"],
            catalog_id="bambu-p1s",
            specs={**(saved.get("specs") or {}), "printer_tolerance": False},
        )
        again = lab.improve_context("sam")
        self.assertNotIn("Printer fit tolerance", again["block"])
        resin = lab.save_profile("sam", catalog_id="elegoo-saturn-4", specs={"printer_tolerance": True})
        resin_block = lab.improve_context("sam")["block"]
        self.assertIn("resin/SLA", resin_block)
        self.assertIn("0.10 mm", resin_block)
        self.assertTrue(resin["printer_tolerance"])
        fine = lab.printer_fit_clearances(
            {"kind": "fdm_printer", "brand": "Bambu Lab", "model": "P1S", "specs": {"nozzle_mm": 0.2}}
        )
        self.assertEqual(fine["sliding_mm"], 0.15)

    def test_delete_active_machine_promotes_remaining(self) -> None:
        first = lab.save_profile("sam", catalog_id="bambu-p1s")
        second = lab.save_profile("sam", catalog_id="prusa-mk4")
        self.assertTrue(second["is_active"])
        lab.delete_profile("sam", second["id"])
        remaining = lab.active_profile("sam")
        self.assertIsNotNone(remaining)
        self.assertEqual(remaining["id"], first["id"])
        self.assertTrue(remaining["is_active"])
        lab.delete_profile("sam", first["id"])
        self.assertIsNone(lab.active_profile("sam"))
        self.assertNotIn("Bambu", lab.improve_context("sam")["block"])

    def test_custom_improve_toggle_off_uses_builtin(self) -> None:
        lab.save_profile("sam", catalog_id="haas-vf2")
        custom = lab.save_custom_improve(
            "sam",
            name="Mill overlay",
            category="CNC",
            prompt="Prefer 2.5D pockets and 6 mm tools.",
            activate=True,
        )
        ctx = lab.improve_context("sam")
        self.assertFalse(ctx["uses_builtin_improve"])
        self.assertIn("2.5D", ctx["block"])
        lab.set_custom_improve_active("sam", None)
        ctx2 = lab.improve_context("sam")
        self.assertTrue(ctx2["uses_builtin_improve"])
        self.assertEqual(custom["category"], "CNC")

    def test_lab_session_four_slots_and_nested_folder(self) -> None:
        session = lab.create_lab_session(
            "sam",
            "proj1",
            prompt="create a enclosure and mount for a",
            slots=[
                {"kind": "original", "label": "No Improve"},
                {"kind": "builtin", "label": "Studio Improve"},
                {"kind": "custom", "label": "No screws", "instruction_id": "abc"},
                {"kind": "custom", "label": "Easy assemble"},
            ],
        )
        self.assertEqual(len(session["slots"]), 4)
        self.assertEqual(session["slots"][0]["kind"], "original")
        root = Path(self.tmp.name) / "proj1"
        root.mkdir()
        dummy = root / "part.glb"
        dummy.write_bytes(b"glb")
        moved = lab.record_lab_result(root, session, slot_index=1, filename="part.glb", label="Studio Improve")
        self.assertIn("Improve Lab", moved["filename"])
        self.assertTrue((root / moved["filename"]).is_file())
        timeline = (root / "references" / "Improve Lab" / session["id"] / "timeline.json")
        self.assertTrue(timeline.is_file())

    def test_drive_oauth_url_uses_drive_scope(self) -> None:
        with patch.object(lab.settings, "google_client_id", "client-x"), patch.object(
            lab.settings, "public_base_url", "https://render3d.app"
        ):
            url = lab.drive_oauth_start_url(user_id="sam", state="nonce")
        from urllib.parse import unquote
        decoded = unquote(url)
        self.assertIn("drive.readonly", url)
        self.assertIn("oauth/drive/callback", decoded)
        self.assertIn("drive:google:sam:", decoded)

    def test_website_fetch_rejects_bad_scheme(self) -> None:
        with self.assertRaises(ValueError):
            lab.fetch_website_text("ftp://example.com/docs")

    def test_nested_lab_file_is_resolvable(self) -> None:
        from backend.services import cad_service

        session = lab.create_lab_session(
            "sam",
            "proj1",
            prompt="create a enclosure and mount for a",
            slots=[{"kind": "original", "label": "No Improve"}],
        )
        root = Path(self.tmp.name) / "proj-resolve"
        root.mkdir()
        dummy = root / "part.glb"
        dummy.write_bytes(b"glb")
        moved = lab.record_lab_result(root, session, slot_index=0, filename="part.glb", label="No Improve")
        hit = cad_service.resolve_project_file(root, moved["filename"])
        self.assertTrue(hit is not None and hit.is_file())
        nested = moved["filename"]
        if nested.startswith("references/"):
            nested = nested[len("references/") :]
        short = cad_service.resolve_project_file(root, nested)
        self.assertTrue(short is not None and hit == short)

    def test_print_profiles_default_and_snapshot(self) -> None:
        first = lab.save_print_profile("sam", name="PLA supports", filament="PLA", supports_enabled=True)
        self.assertTrue(first["is_default"])
        self.assertEqual(first["filament"], "PLA")
        petg = lab.save_print_profile("sam", name="PETG no support", filament="PETG", supports_enabled=False, is_default=True)
        self.assertTrue(petg["is_default"])
        listed = lab.list_print_profiles("sam")
        self.assertEqual(len(listed), 2)
        self.assertTrue(any(p["id"] == first["id"] and not p["is_default"] for p in listed))
        snap = lab.snapshot("sam")
        self.assertEqual(snap["default_print_profile"]["id"], petg["id"])
        self.assertIn("PLA", snap["filaments"])


if __name__ == "__main__":
    unittest.main()
