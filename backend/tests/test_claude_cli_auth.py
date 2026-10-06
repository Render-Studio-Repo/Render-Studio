"""Login handoff regressions; no real accounts, OAuth, or credentials."""
import io
import json
import sqlite3
import subprocess
from types import SimpleNamespace
from collections import OrderedDict
import threading
from unittest.mock import patch

import pytest

from backend.services import claude_cli_auth as auth


class Process:
    def __init__(self, output="", exit_code=None):
        self.stdout = io.StringIO(output)
        self.stdin = io.StringIO()
        self.exit_code = exit_code

    def poll(self):
        return self.exit_code


@pytest.fixture(autouse=True)
def isolated_sessions(tmp_path, monkeypatch):
    monkeypatch.setattr(auth.settings, "data_dir", str(tmp_path))
    with patch.object(auth, "_sessions", {}), patch.object(auth, "_auth_cache", OrderedDict()), patch.object(auth, "_auth_inflight", {}), patch.object(
        auth.subprocess, "run", return_value=SimpleNamespace(returncode=1, stdout="{}")
    ), patch.object(auth, "resolve_claude_bin", return_value="fake-claude"):
        yield


def test_url_is_not_published_until_complete():
    url = "https://claude.ai/oauth/authorize?state=fixture&code_challenge=fixture"
    assert auth._parse_login_output(url[:40])[0] == ""
    assert auth._parse_login_output(url)[0] == ""
    assert auth._parse_login_output(url + "\n")[0] == url


def test_short_unterminated_prompt_is_observed_before_process_exit():
    class LiveOutput:
        def read(self, size):
            assert size == 1  # Larger blocking reads lose the final short prompt.
            if self.parts:
                return self.parts.pop(0)
            observed.set()
            released.wait(2)
            return ""

    observed, released = threading.Event(), threading.Event()
    proc = Process()
    proc.stdout = LiveOutput()
    proc.stdout.parts = list("Paste code here if prompted > ")
    auth._sessions["alice"] = {"proc": proc, "status": "starting"}
    reader = threading.Thread(target=auth._reader, args=("alice", proc))
    reader.start()
    try:
        assert observed.wait(1)
        assert auth.login_status("alice")["needs_code"]
    finally:
        released.set()
        reader.join(2)


def test_pending_session_has_no_generic_login_url():
    auth._sessions["alice"] = {"proc": Process(), "status": "starting"}
    status = auth.login_status("alice")
    assert status["status"] == "starting"
    assert status["login_url"] == ""


def test_dead_session_does_not_poll_forever():
    auth._sessions["alice"] = {"proc": Process(exit_code=1), "status": "awaiting_browser"}
    status = auth.login_status("alice")
    assert status["status"] == "error"
    assert "again" in status["error"]


def test_code_is_sent_only_to_current_users_process_and_not_returned():
    alice, bob = Process(), Process()
    auth._sessions.update(alice={"proc": alice}, bob={"proc": bob})
    with patch.object(auth.time, "time", side_effect=[0, 9]):
        result = auth.submit_login_code("alice", "fixture-code#fixture-state")
    assert alice.stdin.getvalue() == "fixture-code#fixture-state\n"
    assert bob.stdin.getvalue() == ""
    assert "fixture-code" not in str(result)
    assert "log_tail" not in result


@pytest.mark.parametrize("value", ["", "two\ncommands", "x" * 4097])
def test_rejects_empty_multiline_or_oversized_code(value):
    proc = Process()
    auth._sessions["alice"] = {"proc": proc}
    with pytest.raises(ValueError):
        auth.submit_login_code("alice", value)
    assert proc.stdin.getvalue() == ""


def test_code_requires_same_users_live_login():
    auth._sessions["bob"] = {"proc": Process()}
    with pytest.raises(RuntimeError, match="Start Sign in"):
        auth.submit_login_code("alice", "fixture-code#fixture-state")


def test_official_status_recognizes_keychain_only_subscription_without_credential_files():
    metadata = {"loggedIn": True, "authMethod": "claude.ai", "apiProvider": "firstParty",
                "subscriptionType": "max", "email": "alice@example.test", "accessToken": "do-not-return"}
    with patch.object(auth.subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout=json.dumps(metadata))) as run:
        result = auth.read_claude_auth("alice")
    assert result == {"signed_in": True, "account_email": "alice@example.test", "plan_label": "max"}
    assert run.call_args.args[0] == ["fake-claude", "auth", "status", "--json"]
    assert "do-not-return" not in str(result)


def test_official_status_recognizes_saved_setup_token_without_returning_it():
    token = "sk-ant-oat01-" + ("x" * 64)
    metadata = {"loggedIn": True, "authMethod": "oauth_token", "apiProvider": "firstParty"}
    with patch.object(auth, "read_subscription_token", return_value=token), patch.object(
        auth.subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout=json.dumps(metadata))
    ) as run:
        result = auth.read_claude_auth("alice")
    assert result == {"signed_in": True, "account_email": "", "plan_label": "Claude subscription token"}
    assert run.call_args.kwargs["env"]["CLAUDE_CODE_OAUTH_TOKEN"] == token
    assert token not in str(result)


@pytest.mark.parametrize("token", ["", "sk-ant-api03-not-a-subscription-token", "sk-ant-oat short", "x" * 80])
def test_setup_token_validation_rejects_non_subscription_credentials(token):
    with pytest.raises(ValueError, match="claude setup-token"):
        auth._validate_subscription_token(token)


def test_setup_token_is_encrypted_at_rest_and_can_be_cleared(tmp_path):
    db = tmp_path / "tokens.db"

    def connect():
        conn = sqlite3.connect(db)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = OFF")
        return conn

    token = "sk-ant-oat01-" + ("z" * 64)
    with patch.object(auth, "get_conn", side_effect=connect):
        auth.save_subscription_token("alice", token)
        assert auth.read_subscription_token("alice") == token
        with connect() as conn:
            stored = conn.execute("SELECT token_enc FROM claude_subscription_tokens").fetchone()[0]
        assert stored != token
        assert token not in stored
        auth.clear_subscription_token("alice")
        assert auth.read_subscription_token("alice") == ""


def test_email_only_config_is_not_a_connected_subscription():
    home = auth.user_claude_home("alice")
    (home / ".claude.json").write_text('{"email":"stale@example.test"}')
    assert auth.read_claude_auth("alice")["signed_in"] is False


def test_old_connection_cannot_complete_or_kill_pending_reconnect():
    proc = Process()
    auth._sessions["alice"] = {"proc": proc, "status": "awaiting_browser", "needs_code": True}
    with patch.object(auth, "read_claude_auth", return_value={"signed_in": True}):
        result = auth.login_status("alice")
    assert result["status"] == "awaiting_browser"
    assert result["signed_in"] is False


SUBSCRIPTION = {"loggedIn": True, "authMethod": "claude.ai", "apiProvider": "firstParty",
                "subscriptionType": "pro", "email": "alice@example.test"}


def cli_result(metadata=None, code=0):
    return SimpleNamespace(returncode=code, stdout=json.dumps(SUBSCRIPTION if metadata is None else metadata))


@pytest.mark.parametrize("override", [
    {"loggedIn": False}, {"loggedIn": 1}, {"authMethod": "api_key"},
    {"apiProvider": "bedrock"}, {"subscriptionType": ""}, {"subscriptionType": "   "},
    {"subscriptionType": None}, {"subscriptionType": {"accessToken": "secret"}},
])
def test_only_official_first_party_subscription_is_connected(override):
    with patch.object(auth.subprocess, "run", return_value=cli_result({**SUBSCRIPTION, **override})):
        assert auth.read_claude_auth("alice") == {"signed_in": False, "account_email": "", "plan_label": ""}


@pytest.mark.parametrize("output", ["not-json token-secret", "[]", "null", '"secret"'])
def test_malformed_status_fails_closed_without_returning_cli_output(output):
    with patch.object(auth.subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout=output)):
        result = auth.read_claude_auth("alice")
    assert result == {"signed_in": False, "account_email": "", "plan_label": ""}


@pytest.mark.parametrize("failure", [OSError("private-output"), subprocess.TimeoutExpired("fake", 8, output="private-output")])
def test_failed_status_does_not_return_subprocess_details(failure):
    with patch.object(auth.subprocess, "run", side_effect=failure):
        assert auth.read_claude_auth("alice") == {"signed_in": False, "account_email": "", "plan_label": ""}


def test_nonzero_exit_rejects_even_valid_subscription_output():
    with patch.object(auth.subprocess, "run", return_value=cli_result(code=1)):
        assert not auth.read_claude_auth("alice")["signed_in"]


def test_status_environment_and_cache_are_scoped_to_each_render_user(monkeypatch):
    overrides = ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL",
                 "ANTHROPIC_FOUNDRY_API_KEY", "ANTHROPIC_CUSTOM_HEADERS", "CLAUDE_CODE_OAUTH_TOKEN",
                 "CLAUDE_CODE_OAUTH_REFRESH_TOKEN", "CLAUDE_CODE_OAUTH_SCOPES",
                 "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY")
    for name in overrides:
        monkeypatch.setenv(name, "host-secret")
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", "/host/private-config")
    with patch.object(auth.subprocess, "run", side_effect=[cli_result(), cli_result({**SUBSCRIPTION, "email": "bob@example.test"})]) as run:
        assert auth.read_claude_auth("alice")["account_email"] == "alice@example.test"
        assert auth.read_claude_auth("bob")["account_email"] == "bob@example.test"
        for user, call in zip(("alice", "bob"), run.call_args_list):
            home = auth.user_claude_home(user)
            assert call.kwargs["env"]["HOME"] == str(home)
            assert call.kwargs["env"]["CLAUDE_CONFIG_DIR"] == str(home / ".claude")
            assert not any(name in call.kwargs["env"] for name in overrides)
            assert call.kwargs["cwd"] == str(home)
            assert call.kwargs["timeout"] <= 10
            assert call.kwargs["stdin"] == subprocess.DEVNULL


def test_polling_reuses_status_for_thirty_seconds_then_refreshes():
    with patch.object(auth.time, "monotonic", return_value=100) as clock, patch.object(auth.subprocess, "run", return_value=cli_result()) as run:
        first = auth.read_claude_auth("alice")
        first["account_email"] = "must-not-mutate-cache"
        clock.return_value = 129
        assert auth.read_claude_auth("alice")["account_email"] == "alice@example.test"
        assert run.call_count == 1
        clock.return_value = 131
        auth.read_claude_auth("alice")
        assert run.call_count == 2


def test_cache_has_bounded_user_count():
    with patch.object(auth, "_AUTH_CACHE_LIMIT", 2), patch.object(auth.subprocess, "run", return_value=cli_result()) as run:
        for user in ("alice", "bob", "carol", "bob", "alice"):
            auth.read_claude_auth(user)
        assert run.call_count == 4
        assert len(auth._auth_cache) == 2


def test_concurrent_polls_share_one_status_process():
    started, release = threading.Event(), threading.Event()
    results = []

    def status(*args, **kwargs):
        started.set()
        assert release.wait(2)
        return cli_result()

    with patch.object(auth.subprocess, "run", side_effect=status) as run:
        workers = [threading.Thread(target=lambda: results.append(auth.read_claude_auth("alice"))) for _ in range(3)]
        try:
            workers[0].start()
            assert started.wait(1)
            for worker in workers[1:]:
                worker.start()
        finally:
            release.set()
            for worker in workers:
                worker.join(2)
        assert run.call_count == 1
    assert len(results) == 3
    assert all(row["signed_in"] for row in results)
    assert not auth._auth_inflight


def test_invalidated_inflight_result_cannot_restore_old_cached_connection():
    started, release = threading.Event(), threading.Event()
    results = []

    def status(*args, **kwargs):
        started.set()
        assert release.wait(2)
        return cli_result()

    with patch.object(auth.subprocess, "run", side_effect=status):
        worker = threading.Thread(target=lambda: results.append(auth.read_claude_auth("alice")))
        worker.start()
        try:
            assert started.wait(1)
            auth._invalidate_auth("alice")
        finally:
            release.set()
            worker.join(2)
    assert results == [{"signed_in": False, "account_email": "", "plan_label": ""}]
    assert not auth._auth_cache
    assert not auth._auth_inflight


def test_successful_login_refreshes_prior_signed_out_cache():
    with patch.object(auth.subprocess, "run", side_effect=[cli_result(code=1), cli_result()]) as run:
        assert not auth.read_claude_auth("alice")["signed_in"]
        auth._sessions["alice"] = {"proc": Process(exit_code=0), "status": "awaiting_browser", "needs_code": True}
        result = auth.login_status("alice")
        assert result["signed_in"]
        assert result["account_email"] == "alice@example.test"
        assert result["needs_code"] is False
        assert result["login_url"] == ""
        assert run.call_count == 2


def test_failed_login_does_not_report_old_connection_as_success():
    auth._sessions["alice"] = {"proc": Process(exit_code=1), "status": "awaiting_browser"}
    with patch.object(auth.subprocess, "run", return_value=cli_result()) as run:
        result = auth.login_status("alice")
    assert result["status"] == "error"
    assert not result["signed_in"]
    run.assert_not_called()


def test_code_submission_invalidates_previous_cached_status():
    auth._sessions["alice"] = {"proc": Process(), "status": "awaiting_browser"}
    with patch.object(auth.subprocess, "run", return_value=cli_result()) as run:
        auth.read_claude_auth("alice")
        with patch.object(auth.time, "time", side_effect=[0, 9]):
            result = auth.submit_login_code("alice", "fixture-code#fixture-state")
        assert not result["signed_in"]
        auth.read_claude_auth("alice")
        assert run.call_count == 2


def test_logout_uses_official_cli_and_refreshes_cache():
    with patch.object(auth.subprocess, "run", side_effect=[cli_result(), cli_result(), cli_result(code=1)]) as run:
        assert auth.read_claude_auth("alice")["signed_in"]
        result = auth.logout_claude("alice")
    assert not result["signed_in"]
    assert result["error"] == ""
    assert run.call_args_list[1].args[0] == ["fake-claude", "auth", "logout"]
    assert len(run.call_args_list) == 3


def test_failed_logout_preserves_connection_and_reports_error():
    with patch.object(auth.subprocess, "run", side_effect=[cli_result(code=1), cli_result()]):
        result = auth.logout_claude("alice")
    assert result["signed_in"]
    assert "could not be confirmed" in result["error"]
    assert auth.login_status("alice")["signed_in"]
    assert "could not be confirmed" in auth.login_status("alice")["error"]



def test_start_login_invalidates_cache_without_using_old_connection():
    with patch.object(auth.subprocess, "run", return_value=cli_result()) as run:
        auth.read_claude_auth("alice")
        with patch.object(auth.subprocess, "Popen", return_value=Process()) as popen, patch.object(auth.threading, "Thread"), patch.object(auth.time, "time", side_effect=[0, 13]):
            result = auth.start_login("alice")
        assert result["status"] == "starting"
        assert not result["signed_in"]
        assert not auth._auth_cache
        assert run.call_count == 1
        assert popen.call_args.args[0] == ["fake-claude", "auth", "login", "--claudeai"]
        assert popen.call_args.kwargs["env"]["HOME"] == str(auth.user_claude_home("alice"))



def test_current_cli_claude_com_login_url_is_available_with_manual_code_prompt():
    url = "https://claude.com/cai/oauth/authorize?code=true&client_id=fixture&state=fixture"
    output = "Opening browser to sign in…\nIf the browser didn't open, visit: " + url + "\nPaste code here if prompted > "
    assert auth._parse_login_output(output) == (url, True)
    assert auth._parse_login_output(url)[0] == ""
    proc = Process(output)
    auth._sessions["alice"] = {"proc": proc, "status": "starting"}
    auth._reader("alice", proc)
    status = auth.login_status("alice")
    assert status["status"] == "awaiting_browser"
    assert status["login_url"] == url
    assert status["needs_code"] is True


@pytest.mark.parametrize("host", ["claude.com.evil.test", "evilclaude.com", "claude.com@evil.test"])
def test_claude_login_url_does_not_accept_similar_or_spoofed_hosts(host):
    output = "Visit: https://" + host + "/cai/oauth/authorize?state=fixture\n"
    assert auth._parse_login_output(output)[0] == ""



def test_server_claude_process_cannot_open_host_browser(tmp_path, monkeypatch):
    monkeypatch.setenv("BROWSER", "/host/custom-browser")
    env = auth._claude_env(tmp_path)
    assert env["BROWSER"] == "/usr/bin/true"
    assert env["HOME"] == str(tmp_path)
    assert env["CLAUDE_CONFIG_DIR"] == str(tmp_path / ".claude")
