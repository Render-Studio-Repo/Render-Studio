"""X Share-to-X uses per-user consumer keys when stored, else env. Never log secrets."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from backend.services import twitter_link_service as twitter


FAKE_USER_KEY = "testConsumerKey12345678901"
FAKE_USER_SECRET = "testConsumerSecretValueNotReal"
FAKE_ENV_KEY = "envTwitterClientIdValue0001"
FAKE_ENV_SECRET = "envTwitterClientSecretValueNotReal"


class TwitterConsumerCredentialsTests(unittest.TestCase):
    def test_prefers_user_stored_keys_over_env(self) -> None:
        with patch.object(twitter.settings, "twitter_client_id", FAKE_ENV_KEY), patch.object(
            twitter.settings, "twitter_client_secret", FAKE_ENV_SECRET
        ), patch(
            "backend.services.supabase_users_store.x_consumer_credentials",
            return_value=(FAKE_USER_KEY, FAKE_USER_SECRET),
        ):
            key, secret = twitter.consumer_credentials("user-sam")
        self.assertEqual(key, FAKE_USER_KEY)
        self.assertEqual(secret, FAKE_USER_SECRET)

    def test_falls_back_to_env_when_user_has_no_keys(self) -> None:
        with patch.object(twitter.settings, "twitter_client_id", FAKE_ENV_KEY), patch.object(
            twitter.settings, "twitter_client_secret", FAKE_ENV_SECRET
        ), patch(
            "backend.services.supabase_users_store.x_consumer_credentials",
            return_value=None,
        ):
            key, secret = twitter.consumer_credentials("user-other")
        self.assertEqual(key, FAKE_ENV_KEY)
        self.assertEqual(secret, FAKE_ENV_SECRET)

    def test_configured_true_from_user_keys_when_env_empty(self) -> None:
        with patch.object(twitter.settings, "twitter_client_id", ""), patch.object(
            twitter.settings, "twitter_client_secret", ""
        ), patch.object(
            twitter.settings, "twitter_redirect_uri", "https://render3d.app/oauth/twitter/callback"
        ), patch(
            "backend.services.supabase_users_store.x_consumer_credentials",
            return_value=(FAKE_USER_KEY, FAKE_USER_SECRET),
        ):
            self.assertTrue(twitter.configured("user-sam"))
            self.assertFalse(twitter.configured())
            self.assertEqual(twitter.auth_mode("user-sam"), "oauth1")

    def test_status_payload_does_not_include_secrets(self) -> None:
        with patch.object(twitter.settings, "twitter_client_id", FAKE_ENV_KEY), patch.object(
            twitter.settings, "twitter_client_secret", FAKE_ENV_SECRET
        ), patch.object(
            twitter.settings, "twitter_redirect_uri", "https://render3d.app/oauth/twitter/callback"
        ), patch.object(twitter, "linked_account", return_value=None), patch(
            "backend.services.supabase_users_store.x_consumer_credentials",
            return_value=(FAKE_USER_KEY, FAKE_USER_SECRET),
        ):
            payload = twitter.status({"id": "user-sam"})
        blob = str(payload)
        self.assertTrue(payload["configured"])
        self.assertEqual(payload["auth_mode"], "oauth1")
        self.assertNotIn(FAKE_USER_KEY, blob)
        self.assertNotIn(FAKE_USER_SECRET, blob)
        self.assertNotIn(FAKE_ENV_SECRET, blob)


if __name__ == "__main__":
    unittest.main()
