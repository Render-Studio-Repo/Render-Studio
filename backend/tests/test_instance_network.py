from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import instance_network_client as network
from backend.services import instance_setup_service as setup


class InstanceNetworkClientTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.state = Path(self.tmp.name) / "instance_setup.json"
        self.p_state = patch.object(setup, "SETUP_PATH", self.state)
        self.p_state.start()

    def tearDown(self) -> None:
        self.p_state.stop()
        self.tmp.cleanup()

    def test_reporting_requires_explicit_opt_in(self) -> None:
        with patch.object(network, "is_official_hub", return_value=False):
            self.assertFalse(network.reporting_enabled())
            setup._save_state({"instance_reporting_opt_in": True})
            self.assertTrue(network.reporting_enabled())

    def test_public_status_never_contains_network_address(self) -> None:
        with patch.object(network, "_market", return_value={"instance_id": "id", "instance_name": "Shop", "enabled": False, "mode": "private"}), patch.object(network, "is_official_hub", return_value=False):
            status = network.public_status()
        blob = str(status).lower()
        self.assertNotIn("ip_address", blob)
        self.assertNotIn("public_base_url", blob)
        self.assertIn("ip address", blob)

    def test_ecosystem_consent_is_independent_from_reporting(self) -> None:
        with (
            patch.object(network, "is_official_hub", return_value=False),
            patch("backend.services.marketplace_config_service.save"),
            patch("backend.services.marketplace_config_service.answer_install") as answer,
            patch("backend.services.marketplace_hub_client.enroll_instance", return_value={"ok": True}),
            patch.object(network, "public_status", return_value={"ecosystem_opt_in": True, "reporting_opt_in": False}),
        ):
            result = network.configure(
                instance_name="Shop",
                reporting_opt_in=False,
                public_network=False,
                ecosystem_opt_in=True,
            )
        answer.assert_called_once_with(include=True, mode="public")
        self.assertTrue(result["ecosystem_opt_in"])
        self.assertFalse(result["reporting_opt_in"])
        self.assertTrue(setup._load_state()["instance_update_notifications"])

    def test_submit_redacts_secrets(self) -> None:
        sent = []
        with patch.object(network, "_identity_payload", return_value={"instance_id": "x", "instance_secret": "y"}), patch.object(network, "_post", side_effect=lambda path, body, **kw: sent.append((path, body)) or {"ok": True}):
            out = network.submit(kind="issue", subject="Cannot render", message="Authorization: Bearer abc.def.ghi", diagnostic="token=secret")
        self.assertTrue(out["ok"])
        self.assertNotIn("abc.def.ghi", str(sent))

    def test_self_hosted_feedback_is_copied_without_context(self) -> None:
        with (
            patch.object(network, "is_official_hub", return_value=False),
            patch.object(network, "submit", return_value={"ok": True}) as submit,
        ):
            result = network.forward_management_feedback(kind="suggestion", message="Please add a fixture browser")
        self.assertTrue(result["ok"])
        submit.assert_called_once_with(
            kind="suggestion",
            subject="Studio suggestion",
            message="Please add a fixture browser",
            severity="normal",
        )

    def test_update_notifications_are_opt_in(self) -> None:
        with patch.object(network, "is_official_hub", return_value=False):
            self.assertFalse(network.check_for_update()["enabled"])
            network.configure_updates(True)
            with patch("httpx.get", side_effect=RuntimeError("offline")):
                result = network.check_for_update()
            self.assertTrue(result["enabled"])
            self.assertTrue(result["offline"])

    def test_existing_ecosystem_instance_defaults_to_update_notices(self) -> None:
        with (
            patch.object(network, "is_official_hub", return_value=False),
            patch.object(network, "_market", return_value={"enabled": True, "mode": "public", "hub_pull_enabled": True}),
        ):
            self.assertTrue(network.update_notifications_enabled())
            network.configure_updates(False)
            self.assertFalse(network.update_notifications_enabled())

    def test_update_refuses_local_source_changes(self) -> None:
        calls = []

        def fake_git(*args, **_kwargs):
            calls.append(args)
            if args[:3] == ("remote", "get-url", "origin"):
                return "https://github.com/wprojects/Render-Studio.git"
            if args[:2] == ("status", "--porcelain"):
                return " M frontend/studio/app.js"
            return ""

        with patch.object(network, "_git", side_effect=fake_git):
            with self.assertRaisesRegex(ValueError, "local changes"):
                network.apply_update("a" * 40)
        self.assertFalse(any(call and call[0] == "fetch" for call in calls))

    def test_update_refuses_release_that_touches_instance_data(self) -> None:
        def fake_git(*args, **_kwargs):
            if args[:3] == ("remote", "get-url", "origin"):
                return "https://github.com/wprojects/Render-Studio.git"
            if args[:2] == ("status", "--porcelain"):
                return ""
            if args[:2] == ("rev-parse", "refs/remotes/origin/master"):
                return "b" * 40
            if args[:2] == ("diff", "--name-only"):
                return "frontend/index.html\nprojects/customer/model.step"
            return ""

        with patch.object(network, "_git", side_effect=fake_git):
            with self.assertRaisesRegex(ValueError, "protected instance data"):
                network.apply_update("b" * 40)

    def test_update_refuses_commit_other_than_stable_head(self) -> None:
        def fake_git(*args, **_kwargs):
            if args[:3] == ("remote", "get-url", "origin"):
                return "https://github.com/wprojects/Render-Studio.git"
            if args[:2] == ("status", "--porcelain"):
                return ""
            if args[:2] == ("rev-parse", "refs/remotes/origin/master"):
                return "c" * 40
            return ""

        with patch.object(network, "_git", side_effect=fake_git):
            with self.assertRaisesRegex(ValueError, "official stable release"):
                network.apply_update("b" * 40)


if __name__ == "__main__":
    unittest.main()
