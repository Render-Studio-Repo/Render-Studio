from pathlib import Path
from unittest.mock import Mock, patch

import io
import json

from backend.services.codex_launch_env import codex_launch_env
from backend.services.codex_agent import codex_cli_failure_message
from backend.services.chatgpt_codex_auth import _codex_env


def test_reconnect_keeps_old_auth_and_new_login_running(tmp_path):
    from backend.services import chatgpt_codex_auth as auth

    saved = {"auth_mode": "chatgpt", "tokens": {"access_token": "fake-old"}}
    path = tmp_path / "auth.json"
    path.write_text(json.dumps(saved))
    proc = Mock()
    proc.poll.return_value = None
    session = {"proc": proc, "status": "awaiting_browser", "device_code": "TEST-LOCAL"}
    with patch.object(auth, "user_codex_home", return_value=tmp_path), \
         patch.object(auth, "resolve_codex_bin", return_value=Path("/fake/codex")), \
         patch.dict(auth._sessions, {"synthetic-owner": session}, clear=True):
        status = auth.device_auth_status("synthetic-owner")
    assert status["status"] == "awaiting_browser"
    assert status["signed_in"] is False
    assert proc.terminate.call_count == 0
    assert json.loads(path.read_text()) == saved


def test_failed_reconnect_cannot_report_old_auth_as_success(tmp_path):
    from backend.services import chatgpt_codex_auth as auth

    path = tmp_path / "auth.json"
    path.write_text(json.dumps({"auth_mode": "chatgpt", "tokens": {"access_token": "fake-old"}}))
    proc = Mock(stdout=io.StringIO(""))
    proc.poll.return_value = 1
    session = {"proc": proc, "status": "awaiting_browser", "device_code": "TEST-LOCAL"}
    with patch.object(auth, "user_codex_home", return_value=tmp_path), \
         patch.object(auth, "resolve_codex_bin", return_value=Path("/fake/codex")), \
         patch.dict(auth._sessions, {"synthetic-owner": session}, clear=True):
        auth._reader("synthetic-owner", proc)
        status = auth.device_auth_status("synthetic-owner")
    assert status["status"] == "error"
    assert status["signed_in"] is False
    assert status["error"] == "ChatGPT sign-in did not finish. Your saved connection, if any, was not changed."
    assert json.loads(path.read_text())["tokens"]["access_token"] == "fake-old"


def test_completed_reconnect_reports_replacement_auth(tmp_path):
    from backend.services import chatgpt_codex_auth as auth

    (tmp_path / "auth.json").write_text(json.dumps({
        "auth_mode": "chatgpt", "tokens": {"access_token": "fake-old"},
    }))
    stage = tmp_path / ".chatgpt-login-test"
    stage.mkdir()
    (stage / "auth.json").write_text(json.dumps({
        "auth_mode": "chatgpt", "tokens": {"access_token": "fake-replacement",
            "refresh_token": "fake-refresh", "id_token": "fake-id-token"},
    }))
    proc = Mock(stdout=io.StringIO(""))
    proc.poll.return_value = 0
    session = {"proc": proc, "status": "awaiting_browser", "staging_home": stage}
    with patch.object(auth, "user_codex_home", return_value=tmp_path), \
         patch.object(auth, "resolve_codex_bin", return_value=Path("/fake/codex")), \
         patch.dict(auth._sessions, {"synthetic-owner": session}, clear=True):
        auth._reader("synthetic-owner", proc)
        status = auth.device_auth_status("synthetic-owner")
    assert status["status"] == "signed_in"
    assert status["signed_in"] is True
    assert proc.terminate.call_count == 0
    assert json.loads((tmp_path / "auth.json").read_text())["tokens"]["access_token"] == "fake-replacement"
    assert not stage.exists()


def test_selected_api_key_replaces_host_credentials():
    env = codex_launch_env(
        {"CODEX_HOME": "/recipient/api", "CODEX_API_KEY": "selected-fake"},
        inherited={"CODEX_API_KEY": "host-fake", "CODEX_ACCESS_TOKEN": "host-token", "PATH": "/bin"},
    )
    assert env == {"CODEX_HOME": "/recipient/api", "CODEX_API_KEY": "selected-fake", "PATH": "/bin"}


def test_xai_retains_selected_provider_key_without_host_codex_auth():
    from types import SimpleNamespace
    from backend.services.cad_host_runtime import resolve_codex_launch

    ai = SimpleNamespace(provider="xai", api_key="fake-selected-xai", model="grok-test")
    with patch("backend.services.codex_agent.resolve_codex_bin", return_value="codex"), \
         patch("backend.services.cad_host_runtime._chatgpt_home", return_value=None), \
         patch("backend.services.cad_host_runtime._api_key_home", return_value=Path("/tmp/xai-home")):
        launch = resolve_codex_launch(ai, user_id="synthetic-recipient")
    env = codex_launch_env(launch.env, inherited={"CODEX_API_KEY": "host-key", "CODEX_ACCESS_TOKEN": "host-token", "PATH": "/bin"})
    assert env == {"CODEX_HOME": "/tmp/xai-home", "TERM": "dumb", "OPENAI_API_KEY": "fake-selected-xai", "PATH": "/bin"}


def test_subscription_and_device_login_use_owner_home_without_ambient_auth():
    inherited = {
        "OPENAI_API_KEY": "host-api", "CODEX_API_KEY": "host-codex", "CODEX_ACCESS_TOKEN": "host-token",
        "OPENAI_FEDERATION_RULE_ID": "host-rule", "OPENAI_IDENTITY_TOKEN_FILE": "/host-token", "PATH": "/bin",
    }
    selected = {"CODEX_HOME": "/owner/home", "TERM": "dumb"}
    expected = {"CODEX_HOME": "/owner/home", "TERM": "dumb", "PATH": "/bin"}
    assert codex_launch_env(selected, inherited=inherited) == expected
    with patch.dict("os.environ", inherited, clear=True):
        assert _codex_env(Path("/owner/home")) == expected


def test_auth_failure_identifies_selected_credential_not_an_unrelated_model():
    error = "unexpected status 401 Unauthorized: Missing bearer or basic authentication in header"
    assert codex_cli_failure_message(stderr=error, auth_label="openai_api") == (
        "The selected API key could not authenticate (401). "
        "Check that key under Subscriptions. If it is shared, ask its owner to reconnect it."
    )
    assert codex_cli_failure_message(stderr=error, auth_label="chatgpt") == (
        "The selected ChatGPT subscription could not authenticate (401). "
        "Its owner needs to sign in again under Subscriptions."
    )
