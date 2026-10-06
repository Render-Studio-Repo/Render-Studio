from pathlib import Path

from backend.services import robotics_rl_training as rl


def test_profile_is_bounded_and_persisted(tmp_path, monkeypatch):
    monkeypatch.setattr(rl, "STORE", tmp_path)
    saved = rl.save_profile("u1", "p1", {"parallelEnvs": 999, "totalTimesteps": 1, "rewardWeights": {"lift": 7}})
    assert saved["profile"]["parallelEnvs"] == 64
    assert saved["profile"]["totalTimesteps"] == 10_000
    assert rl.get_profile("u1", "p1")["profile"]["rewardWeights"]["lift"] == 7


def test_preflight_is_simulation_only_and_names_missing_ppo(tmp_path, monkeypatch):
    monkeypatch.setattr(rl, "STORE", tmp_path / "profiles")
    monkeypatch.setattr(rl, "ROOT", tmp_path)
    monkeypatch.setattr(rl, "SCENE", tmp_path / "demo.xml")
    monkeypatch.setattr(rl, "PYTHON", Path("/missing/python"))
    out = rl.preflight("u1", "p1")
    assert out["simulationOnly"] is True
    assert out["hardwareAllowed"] is False
    assert out["ok"] is False
    assert "stable baselines3" in out["blockers"]


def test_invalid_project_id_is_rejected(tmp_path, monkeypatch):
    monkeypatch.setattr(rl, "STORE", tmp_path)
    try:
        rl.get_profile("u1", "../other")
    except ValueError as exc:
        assert "project ID" in str(exc)
    else:
        raise AssertionError("unsafe project ID was accepted")
