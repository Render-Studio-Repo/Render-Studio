"""Synthetic credentials only; exercise reconnect without touching a real account."""
import io
import json
from pathlib import Path
from unittest.mock import patch

import pytest

from backend.services import chatgpt_codex_auth as auth


def credentials(account="original"):
    return {"auth_mode": "chatgpt", "tokens": {"access_token": "fixture-access-" + account,
            "refresh_token": "fixture-refresh-" + account, "id_token": "fixture-id-token",
            "account_id": account}}


class Process:
    def __init__(self, code=None):
        self.code = code
        self.stdout = io.StringIO("")

    def poll(self):
        return self.code

    def wait(self, timeout=None):
        return self.code

    def terminate(self):
        self.code = -15

    def kill(self):
        self.code = -9


@pytest.fixture(autouse=True)
def isolate(tmp_path, monkeypatch):
    monkeypatch.setattr(auth.settings, "data_dir", str(tmp_path))
    monkeypatch.setattr(auth, "_sessions", {})
    monkeypatch.setattr(auth, "_link_shared_codex_assets", lambda home: None)
    monkeypatch.setattr(auth, "resolve_codex_bin", lambda: "fake-codex")
    yield
    with auth._lock:
        for user in list(auth._sessions):
            auth._kill_session(user)


def active_file():
    path = auth.user_codex_home("alice") / "auth.json"
    path.write_text(json.dumps(credentials()))
    return path


def launch():
    launches = []
    def popen(command, **kwargs):
        home = Path(kwargs["env"]["CODEX_HOME"])
        (home / "auth.json").unlink(missing_ok=True)
        proc = Process()
        launches.append((home, proc))
        return proc
    with patch.object(auth.subprocess, "Popen", side_effect=popen), patch.object(auth.threading, "Thread"), patch.object(auth.time, "time", side_effect=[0, 13]):
        result = auth.start_device_auth("alice")
    return launches[0][0], launches[0][1], result


def test_native_login_start_cannot_delete_previous_credentials():
    active = active_file()
    before = active.read_bytes()
    stage, _, status = launch()
    assert active.exists(), "Native login must operate in staging, not the connected account home"
    assert active.read_bytes() == before
    assert stage != active.parent
    assert stage.stat().st_mode & 0o777 == 0o700
    assert status["status"] == "starting"
    assert not status["signed_in"]


def test_success_promotes_only_valid_completed_auth_atomically():
    active = active_file()
    stage, proc, _ = launch()
    staged = stage / "auth.json"
    staged.write_text(json.dumps(credentials("replacement")))
    assert json.loads(active.read_text())["tokens"]["account_id"] == "original"
    proc.code = 0
    real_replace = auth.os.replace
    with patch.object(auth.os, "replace", wraps=real_replace) as replace:
        result = auth.device_auth_status("alice")
    replace.assert_called_once_with(staged, active)
    assert result["signed_in"]
    assert json.loads(active.read_text())["tokens"]["account_id"] == "replacement"
    assert active.stat().st_mode & 0o777 == 0o600
    assert not stage.exists()


@pytest.mark.parametrize("value", ["not json", "{}", json.dumps({"auth_mode":"chatgpt"}), json.dumps({"auth_mode":"apikey", "OPENAI_API_KEY":"fake"}), json.dumps({"auth_mode":"chatgpt", "tokens":{"access_token":"fake"}})])
def test_exit_zero_without_valid_chatgpt_credentials_cannot_replace_old(value):
    active = active_file()
    before = active.read_bytes()
    stage, proc, _ = launch()
    (stage / "auth.json").write_text(value)
    proc.code = 0
    assert auth.device_auth_status("alice")["status"] == "error"
    assert active.read_bytes() == before
    assert not stage.exists()


def test_failed_login_preserves_original_even_if_staged_file_exists():
    active = active_file()
    before = active.read_bytes()
    stage, proc, _ = launch()
    (stage / "auth.json").write_text(json.dumps(credentials("failed")))
    proc.code = 1
    assert auth.device_auth_status("alice")["status"] == "error"
    assert active.read_bytes() == before
    assert not stage.exists()


def test_cancelled_login_preserves_original_and_cleans_staging():
    active = active_file()
    before = active.read_bytes()
    stage, proc, _ = launch()
    with auth._lock:
        auth._kill_session("alice")
    assert proc.poll() is not None
    assert not stage.exists()
    assert active.read_bytes() == before
    assert auth.device_auth_status("alice")["signed_in"]


def test_superseded_login_cannot_promote_over_new_session():
    active = active_file()
    old_stage, old_proc, _ = launch()
    (old_stage / "auth.json").write_text(json.dumps(credentials("superseded")))
    old_proc.code = 0
    new_stage, new_proc, _ = launch()
    assert not old_stage.exists()
    auth._finish_device_auth("alice", old_proc)
    assert json.loads(active.read_text())["tokens"]["account_id"] == "original"
    assert auth._sessions["alice"]["proc"] is new_proc
    (new_stage / "auth.json").write_text(json.dumps(credentials("current")))
    new_proc.code = 0
    assert auth.device_auth_status("alice")["signed_in"]
    assert json.loads(active.read_text())["tokens"]["account_id"] == "current"


def test_explicit_logout_removes_active_auth_and_pending_stage():
    active = active_file()
    stage, proc, _ = launch()
    with patch.object(auth.subprocess, "run") as run:
        result = auth.logout_chatgpt("alice")
    assert not result["signed_in"]
    assert not active.exists()
    assert not stage.exists()
    assert proc.poll() is not None
    assert run.call_args.kwargs["env"]["CODEX_HOME"] == str(active.parent)


def test_reader_waits_for_exit_before_promoting_and_closes_output():
    active_file()
    stage, proc, _ = launch()
    (stage / "auth.json").write_text(json.dumps(credentials("completed")))
    def wait(timeout=None):
        proc.code = 0
        return 0
    proc.wait = wait
    auth._reader("alice", proc)
    assert auth.device_auth_status("alice")["signed_in"]
    assert not stage.exists()
    assert proc.stdout.closed


def test_failed_spawn_cleans_stage_without_touching_original():
    active = active_file()
    before = active.read_bytes()
    with patch.object(auth.subprocess, "Popen", side_effect=OSError("synthetic spawn failure")):
        with pytest.raises(OSError):
            auth.start_device_auth("alice")
    assert active.read_bytes() == before
    assert not list(active.parent.glob(".chatgpt-login-*"))


def test_exit_between_status_observations_cannot_report_old_auth_as_new_success():
    active_file()
    stage, proc, _ = launch()
    polls = iter([None, 0, 0])
    proc.poll = lambda: next(polls, 0)
    auth._sessions["alice"]["device_code"] = "TEST-LOCAL"
    result = auth.device_auth_status("alice")
    assert result["status"] == "awaiting_browser"
    assert not result["signed_in"]
    assert auth.device_auth_status("alice")["status"] == "error"
    assert not stage.exists()


def test_logout_serializes_against_reconnect_start():
    import threading
    active = active_file()
    entered, release, spawned = threading.Event(), threading.Event(), threading.Event()
    results = []
    def logout_command(*args, **kwargs):
        entered.set()
        assert release.wait(2)
    def popen(*args, **kwargs):
        spawned.set()
        return Process()
    logout_worker = threading.Thread(target=lambda: results.append(auth.logout_chatgpt("alice")))
    start_worker = threading.Thread(target=lambda: results.append(auth.start_device_auth("alice")))
    with patch.object(auth.subprocess, "run", side_effect=logout_command), patch.object(auth.subprocess, "Popen", side_effect=popen), patch.object(auth.threading, "Thread"), patch.object(auth.time, "time", side_effect=[0, 13]):
        try:
            logout_worker.start()
            assert entered.wait(1)
            start_worker.start()
            assert not spawned.wait(.05)
        finally:
            release.set()
            logout_worker.join(2)
            start_worker.join(2)
    assert not logout_worker.is_alive() and not start_worker.is_alive()
    assert len(results) == 2
    assert spawned.is_set()
    assert not active.exists()
    assert auth._sessions["alice"]["proc"].poll() is None


def test_status_snapshot_cannot_mix_old_auth_with_completed_session():
    import threading
    stage, proc, _ = launch()
    (stage / "auth.json").write_text(json.dumps(credentials("first-connection")))
    read_started, read_release, promoted = threading.Event(), threading.Event(), threading.Event()
    results = []
    real_read, real_promote = auth.read_chatgpt_auth, auth._promote_login
    def paused_read(user):
        value = real_read(user)
        read_started.set()
        assert read_release.wait(2)
        return value
    def promote(*args):
        promoted.set()
        return real_promote(*args)
    status_worker = threading.Thread(target=lambda: results.append(auth.device_auth_status("alice")))
    finish_worker = threading.Thread(target=lambda: auth._finish_device_auth("alice", proc))
    with patch.object(auth, "read_chatgpt_auth", side_effect=paused_read), patch.object(auth, "_promote_login", side_effect=promote):
        try:
            status_worker.start()
            assert read_started.wait(1)
            proc.code = 0
            finish_worker.start()
            assert not promoted.wait(.05)
        finally:
            read_release.set()
            status_worker.join(2)
            finish_worker.join(2)
    assert not status_worker.is_alive() and not finish_worker.is_alive()
    assert results[0]["status"] == "starting"
    assert not results[0]["signed_in"]
    assert auth.device_auth_status("alice")["signed_in"]
