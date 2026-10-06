"""McMaster crawler: catalog misses vs flaky CAD widget, parallel fetch cap."""

from __future__ import annotations

import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import cad_service
from backend.services.mcmaster_fetch_service import (
    _crawl_download_cad,
    _is_retryable_fetch_error,
    _same_family_pns,
    _short_fetch_error,
    can_fetch_mcmaster_step_for_preview,
    extract_product_pns,
    family_prefix,
    fetch_listed_parts_for_project,
    fetch_part_for_project,
    library_has_part,
    looks_like_part_number,
    missing_listed_catalog_pns,
    simplify_search_query,
    substitute_search_queries,
)


class McMasterFetchErrorTests(unittest.TestCase):
    def test_catalog_miss_is_not_retryable(self) -> None:
        err = RuntimeError(
            "McMaster has no product page for 91290A440 (not in catalog). "
            "Buy URL: https://www.mcmaster.com/91290A440/"
        )
        self.assertFalse(_is_retryable_fetch_error(err))
        self.assertIn("no product page", _short_fetch_error(err).lower())

    def test_widget_miss_is_not_retryable(self) -> None:
        err = RuntimeError(
            "McMaster page for 91292A126 loaded but no 3-D STEP download started. "
            "Buy URL: https://www.mcmaster.com/91292A126/"
        )
        self.assertFalse(_is_retryable_fetch_error(err))
        self.assertIn("did not start", _short_fetch_error(err))

    def test_generate_path_uses_one_fetch_attempt(self) -> None:
        dest = Path(tempfile.mkdtemp())
        calls = {"n": 0}

        class _Sess:
            def download_part(self, *_a, **_k):
                calls["n"] += 1
                raise RuntimeError(
                    "McMaster page for 94905K832 loaded but no 3-D STEP download started."
                )

        with self.assertRaises(RuntimeError):
            _crawl_download_cad("94905K832", dest, session=_Sess(), max_attempts=1)
        self.assertEqual(calls["n"], 1)

    def test_retry_has_no_delay(self) -> None:
        dest = Path(tempfile.mkdtemp())
        calls = {"n": 0}

        class _Sess:
            def download_part(self, *_a, **_k):
                calls["n"] += 1
                raise RuntimeError("Timed out opening McMaster 91290A252")

        with patch("backend.services.mcmaster_fetch_service.time.sleep") as slept:
            with self.assertRaises(RuntimeError):
                _crawl_download_cad("91290A252", dest, session=_Sess(), max_attempts=2)
        slept.assert_not_called()
        self.assertEqual(calls["n"], 2)

    def test_part_number_shape(self) -> None:
        self.assertTrue(looks_like_part_number("91290A440"))
        self.assertTrue(looks_like_part_number("91292A126"))
        self.assertFalse(looks_like_part_number("TBD"))

    def test_missing_pn_falls_back_to_family_search(self) -> None:
        self.assertEqual(family_prefix("91290A440"), "91290A")
        self.assertEqual(simplify_search_query("91290A440", original_pn="91290A440"), "")
        self.assertEqual(substitute_search_queries("91290A440", "91290A440"), ["91290A"])
        queries = substitute_search_queries("Black-oxide socket head cap screw", "91290A440")
        self.assertIn("Black-oxide socket head cap screw", queries)
        self.assertIn("91290A", queries)
        self.assertIn("socket head cap screw", queries)

    def test_similar_m4_screw_search_when_length_varies(self) -> None:
        queries = substitute_search_queries(
            "Black-Oxide Alloy Steel Socket Head Screw, M4 x 0.7 mm Thread Size, 12 mm Long",
            "91290A148",
        )
        self.assertIn("M4 socket head cap screw", queries)
        self.assertIn("M4 screw", queries)

    def test_plain_4mm_screw_search_maps_to_m4(self) -> None:
        from backend.services.mcmaster_fetch_service import fastener_search_queries

        q = fastener_search_queries("similar 4 mm screw", "")
        self.assertIn("M4 socket head cap screw", q)

    def test_suggest_typo_4mm_scrw_returns_m4_pns(self) -> None:
        from backend.services.hardware_insert_service import suggest_parts

        hits = suggest_parts("4 mm scrw")
        self.assertGreaterEqual(len(hits), 2)
        self.assertTrue(any("91251A14" in str(h.get("number")) for h in hits))
        self.assertTrue(all(h.get("number") and h.get("title") for h in hits))

    def test_tnut_family_searches_similar_parts(self) -> None:
        queries = substitute_search_queries("5537T75", "5537T75")
        self.assertIn("5537T", queries)
        self.assertIn("drop-in T-nut", queries)

    def test_homepage_hrefs_are_not_used_as_substitutes(self) -> None:
        html = (
            '<a href="/98053A102/">unrelated</a>'
            '<a href="/91290A190/">family size</a>'
            '<a href="https://www.mcmaster.com/91290A440/">dead pn</a>'
        )
        found = extract_product_pns(html, exclude="91290A440")
        self.assertIn("91290A190", found)
        self.assertEqual(_same_family_pns(found, "91290A440"), ["91290A190"])

    def test_parse_markdown_link_part_numbers_dedupes(self) -> None:
        text = """
| Qty | Part number | Description | Used in | Status | Buy |
| --- | --- | --- | --- | --- | --- |
| 1 | 91290A115 | M3 screw | 91290A115.step | on_server | [McMaster](https://www.mcmaster.com/91290A115/) |
| 8 | [91290A115](https://www.mcmaster.com/91290A115/) | M3 screw | planned | planned | [McMaster](https://www.mcmaster.com/91290A115HTTPSWWWMCMASTERCOM91290A115/) |
"""
        rows = cad_service.parse_mcmaster_parts_rows(text)
        pns = [row["part_number"] for row in rows]
        self.assertEqual(pns.count("91290A115"), 1)
        self.assertTrue(all(cad_service.looks_like_mcmaster_part_stem(pn) for pn in pns))

    def test_library_has_part_when_glb_exists(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        (tmp / "91290A115.glb").write_bytes(b"x" * 128)
        found = library_has_part(tmp, "91290A115")
        self.assertIsNotNone(found)
        self.assertTrue(str(found.get("filename") or "").lower().endswith((".glb", ".gltf", ".step")))

    def test_fetch_schedules_preview_glb_instead_of_blocking(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        src = tmp / ".mcmaster_fetch" / "91290A115" / "91290A115.step"
        src.parent.mkdir(parents=True, exist_ok=True)
        src.write_bytes(b"ISO-10303-21;HEADER;")

        def fake_crawl(*_a, **_k):
            return {
                "path": src,
                "part_number": "91290A115",
                "page_url": "https://www.mcmaster.com/91290A115/",
            }

        with patch(
            "backend.services.mcmaster_fetch_service._crawl_download_cad",
            side_effect=fake_crawl,
        ), patch(
            "backend.services.cad_service.tessellate_step_to_glb",
        ) as tess, patch(
            "backend.services.cad_service.schedule_tessellate_step_to_glb",
            return_value=True,
        ) as sched:
            result = fetch_part_for_project(tmp, "91290A115")
        tess.assert_not_called()
        self.assertTrue(sched.called)
        self.assertEqual(result.get("part_number"), "91290A115")
        self.assertEqual(result.get("viewer_filename"), "91290A115.glb")

    def test_fetch_part_skips_crawl_when_glb_exists(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        (tmp / "91290A115.glb").write_bytes(b"x" * 128)
        with patch(
            "backend.services.mcmaster_fetch_service._crawl_download_cad",
            side_effect=AssertionError("should not crawl McMaster when GLB exists"),
        ):
            result = fetch_part_for_project(tmp, "91290A115")
        self.assertTrue(result.get("cached"))
        self.assertEqual(result.get("part_number"), "91290A115")
        self.assertEqual(result.get("viewer_filename"), "91290A115.glb")

    def test_tessellate_reuses_existing_glb(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        step = tmp / "91290A115.step"
        glb = tmp / "91290A115.glb"
        step.write_bytes(b"ISO-10303-21;HEADER;")
        glb.write_bytes(b"x" * 128)
        out = cad_service.tessellate_step_to_glb(step, glb)
        self.assertEqual(out.resolve(), glb.resolve())

    def test_find_step_in_mcmaster_library(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        lib = tmp / "mcmaster_library"
        lib.mkdir()
        step = lib / "91290A115.step"
        step.write_bytes(b"ISO-10303-21;HEADER;")
        found = cad_service.find_step_source(tmp, "91290A115")
        self.assertEqual(found, step)

    def test_prefetch_is_noop_when_glb_or_step_exists(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        (tmp / "91290A115.glb").write_bytes(b"x" * 128)
        lib = tmp / "mcmaster_library"
        lib.mkdir()
        (lib / "91292A126.step").write_bytes(b"ISO-10303-21;HEADER;")
        cad_service.upsert_mcmaster_part(tmp, "91290A115", status="planned")
        cad_service.upsert_mcmaster_part(tmp, "91292A126", status="planned")
        self.assertEqual(missing_listed_catalog_pns(tmp), [])
        with patch(
            "backend.services.mcmaster_fetch_service._crawl_download_cad",
            side_effect=AssertionError("should not crawl when GLB or STEP exists"),
        ):
            out = fetch_listed_parts_for_project(tmp)
        self.assertEqual(out.get("requested"), [])
        text = cad_service.read_mcmaster_parts_list(tmp)
        self.assertIn("on_server", text)
        parsed = cad_service.parse_mcmaster_parts_rows(text)
        self.assertTrue(all(r.get("status") == "on_server" for r in parsed))
        hud = cad_service.mcmaster_parts_progress(tmp)
        self.assertEqual(hud.get("mcmaster_done"), 2)
        self.assertTrue(all(r.get("status") == "on_server" for r in hud["mcmaster_parts"]))

    def test_catalog_miss_is_not_refetched(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        cad_service.upsert_mcmaster_part(
            tmp,
            "91290A440",
            status="fetch_failed",
            used_in="McMaster has no product page for this PN.",
        )
        self.assertEqual(missing_listed_catalog_pns(tmp), [])

    def test_step_miss_is_not_refetched(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        cad_service.upsert_mcmaster_part(
            tmp,
            "91290A324",
            status="fetch_failed",
            used_in="Page loaded; STEP download did not start.",
        )
        self.assertEqual(missing_listed_catalog_pns(tmp), [])

    def test_family_member_used_when_step_miss(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        (tmp / "91290A252.step").write_bytes(b"ISO-10303-21;HEADER;")

        def boom(*_a, **_k):
            raise RuntimeError(
                "McMaster page for 91290A324 loaded but no 3-D STEP download started. "
                "Buy URL: https://www.mcmaster.com/91290A324/"
            )

        with patch(
            "backend.services.mcmaster_fetch_service._crawl_download_cad",
            side_effect=boom,
        ):
            result = fetch_part_for_project(tmp, "91290A324")
        self.assertEqual(result.get("part_number"), "91290A252")
        self.assertEqual(result.get("substituted_from"), "91290A324")
        rows = cad_service.parse_mcmaster_parts_rows(
            cad_service.read_mcmaster_parts_list(tmp)
        )
        by_pn = {row["part_number"]: row for row in rows}
        self.assertEqual(by_pn["91290A324"]["status"], "substituted")

    def test_sync_does_not_downgrade_on_server(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        (tmp / "91290A115.glb").write_bytes(b"x" * 128)
        cad_service.upsert_mcmaster_part(
            tmp,
            "91290A115",
            status="on_server",
            used_in="91290A115.step",
            description="M3 screw",
        )
        cad_service.sync_mcmaster_parts_list(
            tmp,
            cad_brief=(
                "| Qty | Part number | Description | Used in | Status | Buy |\n"
                "| --- | --- | --- | --- | --- | --- |\n"
                "| 1 | 91290A115 | M3 screw | chassis.py | planned | |\n"
            ),
        )
        rows = cad_service.parse_mcmaster_parts_rows(
            cad_service.read_mcmaster_parts_list(tmp)
        )
        self.assertEqual(rows[0]["status"], "on_server")
        self.assertIn("chassis.py", rows[0]["used_in"])

    def test_parts_progress_overlays_disk_when_markdown_says_planned(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        (tmp / "2370T41.glb").write_bytes(b"x" * 128)
        cad_service.upsert_mcmaster_part(tmp, "2370T41", status="planned")
        hud = cad_service.mcmaster_parts_progress(tmp)
        self.assertEqual(hud["mcmaster_parts"][0]["status"], "on_server")
        self.assertEqual(hud.get("mcmaster_done"), 1)

    def test_can_fetch_false_when_glb_or_step_exists(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        (tmp / "91290A115.glb").write_bytes(b"x" * 128)
        self.assertFalse(can_fetch_mcmaster_step_for_preview(tmp, "91290A115"))
        tmp2 = Path(tempfile.mkdtemp())
        (tmp2 / "91292A126.step").write_bytes(b"ISO-10303-21;HEADER;")
        self.assertFalse(can_fetch_mcmaster_step_for_preview(tmp2, "91292A126"))

    def test_catalog_hardware_is_not_viewport_primary(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        (tmp / "91290A115.glb").write_bytes(b"x" * 128)
        (tmp / "91292A126.glb").write_bytes(b"x" * 128)
        tree = cad_service.list_browser_tree(tmp)
        comps = tree.get("components") or []
        self.assertFalse(comps)
        bodies = tree.get("bodies") or []
        self.assertEqual(len(bodies), 1)
        self.assertTrue(bodies[0].get("catalog_hardware_folder"))
        self.assertEqual(bodies[0].get("children_label"), "McMaster Parts")
        hardware = bodies[0].get("children") or []
        self.assertEqual(len(hardware), 2)
        self.assertTrue(all(c.get("catalog_hardware") for c in hardware))
        self.assertFalse(any(c.get("primary") for c in hardware))
        self.assertFalse(any(c.get("auto_load") for c in hardware))
        self.assertIsNone(cad_service.primary_assembly_component(tmp))

    def test_designed_model_is_primary_not_fasteners(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        (tmp / "91290A115.glb").write_bytes(b"x" * 128)
        (tmp / "openarm_chassis.glb").write_bytes(b"x" * 128)
        tree = cad_service.list_browser_tree(tmp)
        comps = tree.get("components") or []
        designed = [c for c in comps if not c.get("catalog_hardware")]
        hardware = designed[0].get("hardware") or [] if designed else []
        self.assertEqual(len(designed), 1)
        self.assertFalse(any(c.get("catalog_hardware") for c in comps))
        self.assertTrue(designed[0].get("primary"))
        self.assertTrue(designed[0].get("auto_load"))
        self.assertTrue(hardware)
        self.assertEqual(designed[0].get("hardware_label"), "McMaster Parts")
        self.assertFalse(any(c.get("auto_load") or c.get("primary") for c in hardware))
        self.assertFalse(tree.get("bodies"))

    def test_all_designed_models_auto_load(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        (tmp / "base.glb").write_bytes(b"x" * 128)
        time.sleep(0.05)
        (tmp / "bracket.glb").write_bytes(b"y" * 128)
        (tmp / "91290A115.glb").write_bytes(b"z" * 128)
        tree = cad_service.list_browser_tree(tmp)
        comps = tree.get("components") or []
        designed = [c for c in comps if not c.get("catalog_hardware")]
        self.assertEqual(len(designed), 2)
        self.assertTrue(all(c.get("auto_load") for c in designed))
        self.assertEqual(sum(1 for c in designed if c.get("primary")), 1)
        nested = [h for c in designed for h in (c.get("hardware") or [])]
        self.assertTrue(nested)
        self.assertFalse(any(h.get("auto_load") or h.get("primary") for h in nested))

    def test_merged_part_is_not_auto_loaded(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        (tmp / "base.glb").write_bytes(b"x" * 128)
        time.sleep(0.05)
        (tmp / "clip.glb").write_bytes(b"y" * 128)
        (tmp / "clip.place.json").write_text(
            json.dumps({"ok": True, "merged": True, "new_stem": "clip"}),
            encoding="utf-8",
        )
        tree = cad_service.list_browser_tree(tmp)
        by_stem = {c["stem"]: c for c in (tree.get("components") or [])}
        self.assertTrue(by_stem["base"].get("auto_load"))
        self.assertFalse(by_stem["clip"].get("auto_load"))
        self.assertTrue(by_stem["base"].get("primary"))

    def test_mcmaster_parts_live_under_bodies_not_components(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        (tmp / "90591A255.glb").write_bytes(b"x" * 128)
        (tmp / "gun_mount.glb").write_bytes(b"x" * 128)
        tree = cad_service.list_browser_tree(tmp)
        names = {c.get("stem") for c in (tree.get("components") or [])}
        self.assertIn("gun_mount", names)
        self.assertNotIn("90591A255", names)
        hardware = (tree.get("components") or [{}])[0].get("hardware") or []
        self.assertEqual([c.get("stem") for c in hardware], ["90591A255"])

    def test_edited_mcmaster_glb_stays_catalog_hardware(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        (tmp / "enclosure.glb").write_bytes(b"x" * 128)
        (tmp / "90592A016_edited.glb").write_bytes(b"y" * 128)
        (tmp / "1013N11_edited.glb").write_bytes(b"z" * 128)
        self.assertTrue(cad_service.looks_like_mcmaster_part_stem("90592A016_edited"))
        self.assertTrue(cad_service.looks_like_mcmaster_part_stem("1013N11_edited"))
        tree = cad_service.list_browser_tree(tmp)
        comps = tree.get("components") or []
        self.assertEqual([c.get("stem") for c in comps], ["enclosure"])
        hardware_stems = {h.get("stem") for h in (comps[0].get("hardware") or [])}
        self.assertEqual(hardware_stems, {"90592A016_edited", "1013N11_edited"})
        self.assertFalse(any(h.get("auto_load") or h.get("primary") for h in (comps[0].get("hardware") or [])))

    def test_resolve_project_file_finds_library_glb(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        lib = tmp / "mcmaster_library"
        lib.mkdir()
        glb = lib / "91290A115.glb"
        glb.write_bytes(b"x" * 128)
        found = cad_service.resolve_project_file(tmp, "91290A115.glb")
        self.assertEqual(found, glb)

    def test_worker_inputs_resolve_library_step(self) -> None:
        from backend.services.engine_layout import sibling_with_suffix
        from backend.services.vibecad_service import _resolve_worker_inputs

        tmp = Path(tempfile.mkdtemp())
        lib = tmp / "mcmaster_library"
        lib.mkdir()
        step = lib / "91290A115.step"
        step.write_bytes(b"ISO-10303-21;HEADER;")
        found = sibling_with_suffix(tmp, "91290A115.step", (".step", ".stp"))
        self.assertEqual(found, step)
        resolved = _resolve_worker_inputs(tmp, {"hw_91290A115": "91290A115.step"})
        self.assertEqual(Path(resolved["hw_91290A115"]).resolve(), step.resolve())

    def test_latest_model_file_skips_catalog_hardware(self) -> None:
        from backend.services.project_store import latest_model_file

        tmp = Path(tempfile.mkdtemp())
        (tmp / "91290A115.glb").write_bytes(b"x" * 128)
        chassis = tmp / "openarm_chassis.glb"
        chassis.write_bytes(b"x" * 128)
        import os
        import time

        now = time.time()
        os.utime(tmp / "91290A115.glb", (now + 10, now + 10))
        os.utime(chassis, (now, now))
        latest = latest_model_file(tmp)
        self.assertEqual(latest, "openarm_chassis.glb")

    def test_latest_model_file_none_when_only_hardware(self) -> None:
        from backend.services.project_store import latest_model_file

        tmp = Path(tempfile.mkdtemp())
        (tmp / "91290A115.glb").write_bytes(b"x" * 128)
        self.assertIsNone(latest_model_file(tmp))

    def test_design_prefetch_noop_when_on_disk(self) -> None:
        from backend.services.design_service import _prefetch_mcmaster_catalog_steps

        tmp = Path(tempfile.mkdtemp())
        (tmp / "91290A115.glb").write_bytes(b"x" * 128)
        cad_service.upsert_mcmaster_part(tmp, "91290A115", status="planned")
        with patch(
            "backend.services.mcmaster_fetch_service.fetch_listed_parts_for_project",
            side_effect=AssertionError("prefetch should be a no-op when PNs are on disk"),
        ):
            _prefetch_mcmaster_catalog_steps(tmp)
        rows = cad_service.parse_mcmaster_parts_rows(
            cad_service.read_mcmaster_parts_list(tmp)
        )
        self.assertEqual(rows[0]["status"], "on_server")

    def test_named_buy_links_round_trip(self) -> None:
        md = cad_service.render_mcmaster_parts_list_markdown(
            [
                {
                    "qty": "1",
                    "part_number": "2370T41",
                    "description": "Cart-King Caster, Swivel with Brake / McMaster-Carr",
                    "used_in": "chassis.py",
                    "status": "on_server",
                    "buy_url": "https://www.mcmaster.com/2370T41/",
                }
            ]
        )
        self.assertIn("[Cart-King Caster, Swivel with Brake](https://www.mcmaster.com/2370T41/)", md)
        self.assertIn("[2370T41](https://www.mcmaster.com/2370T41/)", md)
        self.assertNotIn("[McMaster](", md)
        rows = cad_service.parse_mcmaster_parts_rows(md)
        self.assertEqual(rows[0]["part_number"], "2370T41")
        self.assertEqual(rows[0]["description"], "Cart-King Caster, Swivel with Brake")
        self.assertEqual(rows[0]["buy_url"], "https://www.mcmaster.com/2370T41/")

    def test_list_reference_hides_per_part_markdown(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        folder = tmp / "references" / "McMaster"
        folder.mkdir(parents=True)
        (folder / "parts_list.md").write_text("# McMaster-Carr parts list\n", encoding="utf-8")
        (folder / "mcmaster_2370T41.md").write_text("# leftover spec\n", encoding="utf-8")
        listed = cad_service.list_reference_files(tmp)
        names = {row["name"] for row in listed}
        self.assertIn("parts_list.md", names)
        self.assertNotIn("mcmaster_2370T41.md", names)
        parts = next(row for row in listed if row["name"] == "parts_list.md")
        self.assertEqual(parts.get("label"), "Parts list")


if __name__ == "__main__":
    unittest.main()
