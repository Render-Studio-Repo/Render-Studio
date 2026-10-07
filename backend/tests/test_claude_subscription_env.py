"""Subscription login and generation must use the same isolated CLI account."""
import os
from unittest.mock import patch

from backend.services import claude_cli_auth, cli_subscription_llm


def test_generation_reuses_account_environment(tmp_path):
    home = tmp_path / "alice"
    saved = "sk-ant-oat01-" + ("s" * 64)
    with patch.object(claude_cli_auth, "user_claude_home", return_value=home), patch.object(
        claude_cli_auth, "read_subscription_token", return_value=saved
    ), patch.object(
        cli_subscription_llm, "_venv_bin", return_value=None
    ), patch.dict(os.environ, {
        "ANTHROPIC_API_KEY": "fixture-api-key",
        "ANTHROPIC_AUTH_TOKEN": "fixture-other-account",
        "CLAUDE_CODE_OAUTH_TOKEN": "fixture-other-login",
        "CLAUDE_CODE_OAUTH_REFRESH_TOKEN": "fixture-refresh",
        "CLAUDE_CODE_OAUTH_SCOPES": "fixture-scopes",
        "ANTHROPIC_BASE_URL": "https://fixture.invalid",
        "ANTHROPIC_FOUNDRY_API_KEY": "fixture-foundry",
        "CLAUDE_CODE_USE_BEDROCK": "1",
        "CLAUDE_CODE_USE_VERTEX": "1",
        "CLAUDE_CODE_USE_FOUNDRY": "1",
    }):
        generation = cli_subscription_llm._host_env("claude", "alice")
        login = claude_cli_auth._claude_env(home, user_id="alice")
    assert generation["HOME"] == login["HOME"] == str(home)
    assert generation["CLAUDE_CONFIG_DIR"] == login["CLAUDE_CONFIG_DIR"] == str(home / ".claude")
    assert generation["CLAUDE_CODE_OAUTH_TOKEN"] == login["CLAUDE_CODE_OAUTH_TOKEN"] == saved
    for key in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN",
                "CLAUDE_CODE_OAUTH_REFRESH_TOKEN", "CLAUDE_CODE_OAUTH_SCOPES",
                "ANTHROPIC_BASE_URL", "ANTHROPIC_FOUNDRY_API_KEY",
                "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"):
        assert key not in generation
        assert key not in login


def test_generation_does_not_share_user_directories(tmp_path):
    with patch.object(claude_cli_auth, "user_claude_home", side_effect=lambda uid: tmp_path / uid):
        alice = cli_subscription_llm._host_env("claude", "alice")
        bob = cli_subscription_llm._host_env("claude", "bob")
    assert alice["HOME"] != bob["HOME"]
    assert alice["CLAUDE_CONFIG_DIR"] != bob["CLAUDE_CONFIG_DIR"]
