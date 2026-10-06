"""Existing wiring storage/repair must keep physical geometry and source evidence."""
import unittest
from backend.services.wiring_service import _normalize_schematic, validate_and_repair_schematic

class WiringSpatialMetadataTests(unittest.TestCase):
    def test_normalize_and_repair_retain_physical_metadata(self):
        component = {'id': 'sensor', 'type': 'sensor', 'label': 'Sensor', 'pins': [{'id': 'OUT', 'position3d': [1, 2, 3], 'units': 'mm'}], 'position3d': [0, 0, 0], 'documentation': [{'type': 'schematic', 'url': 'https://example.com/schematic.pdf'}]}
        wire = {'id': 'w1', 'from': {'componentId': 'sensor', 'pinId': 'OUT'}, 'to': {'componentId': 'board', 'pinId': 'GPIO17'}, 'gauge': '22 AWG', 'route3d': {'units': 'mm', 'points': [[1, 2, 3], [20, 2, 3]]}, 'connectors': {'from': 'JST-XH'}, 'verification': 'provisional'}
        result, _ = validate_and_repair_schematic(_normalize_schematic({'components': [component, {'id': 'board', 'type': 'raspberry-pi'}], 'wires': [wire]}))
        self.assertEqual(result['components'][0], component)
        self.assertEqual(result['wires'][0], wire)

if __name__ == '__main__':
    unittest.main()
