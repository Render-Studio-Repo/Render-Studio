"""SolidWorks personal library add / list / replace."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import solidworks_library as sw


class SolidworksLibraryTests(unittest.TestCase):
    def test_add_list_replace(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        with patch.object(sw.settings, "data_dir", str(tmp)):
            added = sw.add_item("user1", "Bracket.sldprt", b"sld-bytes", folder="Hardware")
            self.assertEqual(added["filename"], "Bracket.sldprt")
            listed = sw.list_items("user1")
            self.assertEqual(len(listed), 1)
            self.assertEqual(listed[0]["folder"], "Hardware")
            got = sw.get_item("user1", added["id"])
            self.assertIsNotNone(got)
            self.assertEqual(got["path"].read_bytes(), b"sld-bytes")
            sw.replace_item("user1", added["id"], "Bracket.step", b"ISO-10303")
            got2 = sw.get_item("user1", added["id"])
            self.assertEqual(got2["filename"], "Bracket.step")
            self.assertEqual(got2["path"].read_bytes(), b"ISO-10303")
            self.assertTrue(sw.delete_item("user1", added["id"]))
            self.assertEqual(sw.list_items("user1"), [])
