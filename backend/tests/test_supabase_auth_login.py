"""Login form routes to Supabase Auth (GoTrue password grant)."""

from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from backend.services import supabase_auth_service as sbauth
from backend.services import supabase_client


class SignInRoutingTests(unittest.TestCase):
    def test_sign_in_uses_password_grant_on_auth_client(self) -> None:
        client = MagicMock()
        client.auth.sign_in_with_password.return_value = SimpleNamespace(
            user=SimpleNamespace(
                id="sb-1",
                email="sam@example.com",
                user_metadata={"app_user_id": "u1"},
            ),
            session=SimpleNamespace(access_token="t"),
        )
        with (
            patch.object(sbauth, "enabled", return_value=True),
            patch.object(supabase_client, "iter_auth_clients", return_value=iter([client])),
        ):
            out = sbauth.sign_in("sam@example.com", "pw")
        self.assertTrue(out["ok"])
        self.assertEqual(out["user"]["id"], "sb-1")
        client.auth.sign_in_with_password.assert_called_once_with(
            {"email": "sam@example.com", "password": "pw"}
        )

    def test_invalid_credentials_are_not_unreachable(self) -> None:
        client = MagicMock()
        err = Exception("Invalid login credentials")
        err.status = 400  # type: ignore[attr-defined]
        client.auth.sign_in_with_password.side_effect = err
        with (
            patch.object(sbauth, "enabled", return_value=True),
            patch.object(supabase_client, "iter_auth_clients", return_value=iter([client])),
        ):
            out = sbauth.sign_in("sam@example.com", "wrong")
        self.assertFalse(out["ok"])
        self.assertEqual(out["error"], "invalid")

    def test_misconfigured_env_names_match_settings(self) -> None:
        supabase_client.clear_client_cache()
        with (
            patch.object(supabase_client.settings, "users_backend", "supabase"),
            patch.object(supabase_client.settings, "supabase_url", ""),
            patch.object(supabase_client.settings, "supabase_publishable_key", ""),
            patch.object(supabase_client.settings, "supabase_service_role_key", ""),
            patch.object(supabase_client.settings, "supabase_secret_key", ""),
            patch.object(supabase_client.settings, "supabase_key", ""),
        ):
            msg = supabase_client.supabase_login_misconfigured()
        self.assertIn("SUPABASE_URL", msg)
        self.assertIn("SUPABASE_PUBLISHABLE_KEY", msg)
        self.assertIn("SUPABASE_SERVICE_ROLE_KEY", msg)

    def test_partial_url_without_key_is_misconfigured(self) -> None:
        with (
            patch.object(supabase_client.settings, "users_backend", ""),
            patch.object(supabase_client.settings, "supabase_url", "https://example.supabase.co"),
            patch.object(supabase_client.settings, "supabase_publishable_key", ""),
            patch.object(supabase_client.settings, "supabase_service_role_key", ""),
            patch.object(supabase_client.settings, "supabase_secret_key", ""),
            patch.object(supabase_client.settings, "supabase_key", ""),
        ):
            msg = supabase_client.supabase_login_misconfigured()
        self.assertIn("SUPABASE_PUBLISHABLE_KEY", msg)

    def test_local_backend_ignores_missing_supabase(self) -> None:
        with (
            patch.object(supabase_client.settings, "users_backend", "local"),
            patch.object(supabase_client.settings, "supabase_url", ""),
            patch.object(supabase_client.settings, "supabase_publishable_key", ""),
            patch.object(supabase_client.settings, "supabase_service_role_key", ""),
            patch.object(supabase_client.settings, "supabase_secret_key", ""),
            patch.object(supabase_client.settings, "supabase_key", ""),
        ):
            self.assertEqual(supabase_client.supabase_login_misconfigured(), "")

    def test_get_auth_client_prefers_publishable_key(self) -> None:
        supabase_client.clear_client_cache()
        fake = object()
        with (
            patch.object(supabase_client.settings, "supabase_url", "https://example.supabase.co"),
            patch.object(supabase_client.settings, "supabase_publishable_key", "sb_publishable_test"),
            patch.object(supabase_client.settings, "supabase_service_role_key", "service_role_not_for_grant"),
            patch.object(supabase_client.settings, "supabase_secret_key", ""),
            patch.object(supabase_client.settings, "supabase_key", ""),
            patch("supabase.create_client", return_value=fake) as created,
        ):
            client = supabase_client.get_auth_client()
        self.assertIs(client, fake)
        created.assert_called_once_with("https://example.supabase.co", "sb_publishable_test")
        supabase_client.clear_client_cache()


if __name__ == "__main__":
    unittest.main()
