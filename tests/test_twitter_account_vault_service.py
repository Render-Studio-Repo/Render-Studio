from __future__ import annotations

import json
from datetime import datetime, timezone

from backend import database
from backend.services import twitter_account_vault_service as vault
from backend.services import twitter_repost_service


def _seed_user(user_id: str) -> None:
    with database.get_conn() as conn:
        conn.execute(
            "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
            (
                user_id,
                f"{user_id}@example.com",
                "Test User",
                "not-used",
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        conn.commit()


def _use_temp_db(tmp_path, monkeypatch):
    monkeypatch.setattr(database, "DB_PATH", (tmp_path / "render3d.db").resolve())
    database.init_db()
    monkeypatch.setattr(vault, "_supabase_enabled", lambda: False)


def test_upsert_keeps_primary_and_encrypts_all_tokens(tmp_path, monkeypatch):
    _use_temp_db(tmp_path, monkeypatch)
    user_id = "user-twitter-multi"
    _seed_user(user_id)

    primary = vault.upsert_account(
        user_id,
        access_token="primary-access-token",
        refresh_token="oauth1:primary-secret-token",
        expires_at="2036-09-07T00:05:17.590188+00:00",
        scope="oauth1",
        profile={
            "id": "1377293227896811521",
            "username": "A1_Projects",
            "name": "Sam W",
            "profile_image_url": "https://example.com/a1.png",
        },
    )
    secondary = vault.upsert_account(
        user_id,
        access_token="secondary-access-token",
        refresh_token="oauth1:secondary-secret-token",
        expires_at="2036-10-01T00:00:00+00:00",
        scope="oauth1",
        profile={
            "id": "2091282286842974208",
            "username": "Winstead_Works",
            "name": "Sam W",
            "profile_image_url": "https://example.com/winstead.png",
        },
    )

    accounts = vault.list_accounts(user_id)
    assert primary["username"] == "A1_Projects"
    assert secondary["username"] == "Winstead_Works"
    assert [account["username"] for account in accounts] == ["A1_Projects", "Winstead_Works"]
    assert accounts[0]["is_primary"] is True
    assert accounts[1]["is_primary"] is False

    auth = vault.get_account_auth(user_id, "Winstead_Works")
    assert auth["access_token"] == "secondary-access-token"
    assert auth["refresh_token"] == "oauth1:secondary-secret-token"
    assert auth["oauth1_access_token"] == "secondary-access-token"
    assert auth["oauth1_access_token_secret"] == "secondary-secret-token"

    with database.get_conn() as conn:
        row = conn.execute(
            "SELECT access_token, refresh_token, accounts_json FROM twitter_oauth_tokens WHERE user_id = ?",
            (user_id,),
        ).fetchone()
    assert row is not None
    assert str(row["access_token"]).startswith("gAAAAA")
    assert str(row["refresh_token"]).startswith("gAAAAA")
    extras = json.loads(row["accounts_json"] or "[]")
    assert len(extras) == 1
    assert str(extras[0]["access_token_enc"]).startswith("gAAAAA")
    assert str(extras[0]["refresh_token_enc"]).startswith("gAAAAA")
    assert str(extras[0]["oauth1_access_token_enc"]).startswith("gAAAAA")
    assert str(extras[0]["oauth1_access_token_secret_enc"]).startswith("gAAAAA")
    assert "secondary-access-token" not in row["accounts_json"]


def test_listing_migrates_legacy_plaintext_tokens_to_ciphertext(tmp_path, monkeypatch):
    _use_temp_db(tmp_path, monkeypatch)
    user_id = "user-twitter-legacy"
    _seed_user(user_id)
    vault._ensure_tables()

    legacy_accounts = [
        {
            "scope": "oauth1",
            "username": "Winstead_Works",
            "display_name": "Sam W",
            "twitter_user_id": "2091282286842974208",
            "picture_url": "https://example.com/winstead.png",
            "expires_at": "2036-10-01T00:00:00+00:00",
            "access_token": "secondary-raw-access",
            "refresh_token": "oauth1:secondary-raw-secret",
            "created_at": "2026-09-23T00:00:00+00:00",
            "updated_at": "2026-09-23T00:00:00+00:00",
        }
    ]
    with database.get_conn() as conn:
        conn.execute(
            """
            INSERT INTO twitter_oauth_tokens
              (user_id, access_token, refresh_token, expires_at, scope, twitter_user_id,
               username, display_name, picture_url, created_at, updated_at, accounts_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user_id,
                "primary-raw-access",
                "oauth1:primary-raw-secret",
                "2036-09-07T00:05:17.590188+00:00",
                "oauth1",
                "1377293227896811521",
                "A1_Projects",
                "Sam W",
                "https://example.com/a1.png",
                "2026-09-23T00:00:00+00:00",
                "2026-09-23T00:00:00+00:00",
                json.dumps(legacy_accounts),
            ),
        )
        conn.commit()

    accounts = vault.list_accounts(user_id)
    assert [account["username"] for account in accounts] == ["A1_Projects", "Winstead_Works"]

    with database.get_conn() as conn:
        row = conn.execute(
            "SELECT access_token, refresh_token, accounts_json FROM twitter_oauth_tokens WHERE user_id = ?",
            (user_id,),
        ).fetchone()
    assert row is not None
    assert str(row["access_token"]).startswith("gAAAAA")
    assert str(row["refresh_token"]).startswith("gAAAAA")
    extras = json.loads(row["accounts_json"] or "[]")
    assert str(extras[0]["access_token_enc"]).startswith("gAAAAA")
    assert str(extras[0]["refresh_token_enc"]).startswith("gAAAAA")
    assert str(extras[0]["oauth1_access_token_enc"]).startswith("gAAAAA")
    assert str(extras[0]["oauth1_access_token_secret_enc"]).startswith("gAAAAA")


def test_poll_and_repost_orders_oldest_first_and_tracks_state(monkeypatch):
    reposted: list[str] = []
    saved: dict[str, object] = {}
    monkeypatch.setattr(twitter_repost_service, "enabled", lambda: True)

    monkeypatch.setattr(
        twitter_repost_service,
        "load_state",
        lambda *args, **kwargs: {
            "user_id": "sam-user",
            "repost_as_username": "A1_Projects",
            "source_username": "Winstead_Works",
            "last_seen_id": None,
            "reposted_ids": [],
        },
    )
    monkeypatch.setattr(
        twitter_repost_service,
        "save_state",
        lambda *args, **kwargs: saved.update(kwargs["state"]),
    )
    monkeypatch.setattr(
        twitter_repost_service,
        "fetch_recent_posts",
        lambda *args, **kwargs: [
            {"id": "200", "created_at": "2026-09-23T20:05:00+00:00"},
            {"id": "100", "created_at": "2026-09-23T20:00:00+00:00"},
        ],
    )
    monkeypatch.setattr(
        twitter_repost_service,
        "repost_post",
        lambda user_id, *, repost_as_username, tweet_id: reposted.append(tweet_id) or {
            "tweet_id": tweet_id,
            "reposted": True,
            "actor_username": repost_as_username,
        },
    )
    monkeypatch.setattr(
        twitter_repost_service,
        "state_path",
        lambda *args, **kwargs: database.DB_PATH.parent / "scheduled-social" / "x-repost-test.json",
    )

    result = twitter_repost_service.poll_and_repost(
        "sam-user",
        source_username="Winstead_Works",
        repost_as_username="A1_Projects",
    )

    assert result["ok"] is True
    assert reposted == ["100", "200"]
    assert result["tweet_ids"] == ["100", "200"]
    assert saved["last_seen_id"] == "200"
    assert saved["reposted_ids"] == ["100", "200"]
