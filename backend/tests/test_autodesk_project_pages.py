"""Fusion Library must follow Autodesk pagination or later projects disappear."""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from backend.services import autodesk_oauth


def _ok(payload: dict) -> MagicMock:
    resp = MagicMock()
    resp.is_success = True
    resp.status_code = 200
    resp.content = b"{}"
    resp.json.return_value = payload
    return resp


class AutodeskProjectPagesTests(unittest.TestCase):
    def test_list_projects_follows_next_page(self) -> None:
        page1 = _ok({
            "data": [{"id": "p1", "type": "projects", "attributes": {"name": "Recent Arm"}}],
            "links": {
                "next": {
                    "href": "https://developer.api.autodesk.com/project/v1/hubs/h1/projects?page[number]=1&page[limit]=200",
                }
            },
        })
        page2 = _ok({
            "data": [{"id": "p2", "type": "projects", "attributes": {"name": "VR Clamps"}}],
            "links": {},
        })

        with patch.object(autodesk_oauth.httpx, "get", side_effect=[page1, page2]) as get:
            projects = autodesk_oauth.list_projects("token", "h1")

        names = {p["name"] for p in projects}
        self.assertIn("Recent Arm", names)
        self.assertIn("VR Clamps", names)
        self.assertEqual(get.call_count, 2)
        first_kwargs = get.call_args_list[0].kwargs
        self.assertEqual(first_kwargs["params"]["page[limit]"], 200)
        self.assertIsNone(get.call_args_list[1].kwargs.get("params"))

    def test_ignores_next_href_off_autodesk_host(self) -> None:
        page = _ok({
            "data": [{"id": "p1", "type": "projects", "attributes": {"name": "Only Page"}}],
            "links": {"next": {"href": "https://evil.example/steal"}},
        })
        with patch.object(autodesk_oauth.httpx, "get", return_value=page) as get:
            projects = autodesk_oauth.list_projects("token", "h1")
        self.assertEqual([p["name"] for p in projects], ["Only Page"])
        self.assertEqual(get.call_count, 1)

    def test_folder_contents_merges_included_across_pages(self) -> None:
        page1 = _ok({
            "data": [{"type": "items", "id": "i1", "attributes": {"displayName": "A"}}],
            "included": [{"id": "v1", "type": "versions"}],
            "links": {
                "next": {
                    "href": "https://developer.api.autodesk.com/data/v1/projects/p/folders/f/contents?page[number]=1",
                }
            },
        })
        page2 = _ok({
            "data": [{"type": "folders", "id": "f2", "attributes": {"name": "More"}}],
            "included": [{"id": "v2", "type": "versions"}],
        })
        with patch.object(autodesk_oauth.httpx, "get", side_effect=[page1, page2]):
            with patch.object(autodesk_oauth, "_normalize_item", side_effect=lambda item, included: {
                "id": item["id"],
                "included_ids": sorted(included),
            }):
                with patch.object(autodesk_oauth, "_normalize_folder", side_effect=lambda folder, _pid: {
                    "id": folder["id"],
                    "name": (folder.get("attributes") or {}).get("name"),
                }):
                    out = autodesk_oauth.list_folder_contents("token", "p", "f")
        self.assertEqual(len(out["items"]), 1)
        self.assertEqual(out["items"][0]["included_ids"], ["v1", "v2"])
        self.assertEqual(out["folders"][0]["name"], "More")
