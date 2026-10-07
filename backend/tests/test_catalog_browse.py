import unittest
from unittest.mock import patch

from backend.services import part_profiles_service as svc


class _Resp:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


def _part(pid, name, category="electronics"):
    return {
        "id": pid,
        "name": name,
        "description": f"{name} STEP model",
        "category": category,
        "family": "demo",
        "tags": [],
        "attributes": {},
        "pageUrl": f"https://www.step.parts/parts/{pid}",
        "productPage": "https://example.com/buy",
        "stepUrl": f"https://example.com/{pid}.step",
        "glbUrl": f"https://example.com/{pid}.glb",
        "pngUrl": f"https://example.com/{pid}.png",
    }


class CatalogBrowseTests(unittest.TestCase):
    def test_empty_search_returns_popular_step_parts_not_marketplace_stubs(self):
        payload = {
            "items": [_part("nema_17", "NEMA 17 stepper", "actuator")],
        }
        with patch("backend.services.part_profiles_service.httpx.get", return_value=_Resp(payload)):
            data = svc.search_catalog("", sources=["step_parts"], limit=8)
        self.assertTrue(data["candidates"])
        self.assertEqual(data["heading"], "Popular right now")
        self.assertTrue(all(c.get("step_url") for c in data["candidates"]))
        self.assertFalse(any(str(c.get("id") or "").startswith("amazon:") for c in data["candidates"]))

    def test_category_browse_passes_step_parts_filter(self):
        captured = {}

        def fake_get(url, params=None, timeout=None):
            captured["params"] = params
            return _Resp({"items": [_part("m3_shcs", "M3 SHCS", "fastener")]})

        with patch("backend.services.part_profiles_service.httpx.get", side_effect=fake_get):
            data = svc.search_catalog("", sources=["step_parts"], limit=6, category="fastener")
        self.assertEqual(captured["params"].get("category"), "fastener")
        self.assertEqual(data["candidates"][0]["id"], "m3_shcs")
        self.assertTrue(data["candidates"][0]["importable"])


if __name__ == "__main__":
    unittest.main()
