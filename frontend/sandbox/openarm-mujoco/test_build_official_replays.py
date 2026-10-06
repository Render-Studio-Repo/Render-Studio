import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from build_official_replays import build_episode


class OfficialReplayTest(unittest.TestCase):
    def test_rejects_missing_or_unsuccessful_episode(self):
        with self.assertRaisesRegex(ValueError, "absent or not marked successful"):
            build_episode(ROOT / "v2/cell/demo.xml", [], 0)


if __name__ == "__main__":
    unittest.main()
