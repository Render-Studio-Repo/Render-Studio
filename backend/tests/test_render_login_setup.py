import unittest
from unittest.mock import patch

from backend.services import instance_network_client


class _Response:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


class RenderLoginSetupTests(unittest.TestCase):
    def test_login_check_returns_official_urls_and_provider_status(self):
        with patch("httpx.get", side_effect=[_Response({"status": "ok"}), _Response({"providers": ["google"]})]):
            status = instance_network_client.render_login_status()
        self.assertTrue(status["reachable"])
        self.assertEqual(status["providers"], ["google"])
        self.assertEqual(status["login_url"], "https://render3d.app/?login=1&source=desktop-setup")
        self.assertEqual(status["signup_url"], "https://render3d.app/?signup=1&source=desktop-setup")


if __name__ == "__main__":
    unittest.main()
