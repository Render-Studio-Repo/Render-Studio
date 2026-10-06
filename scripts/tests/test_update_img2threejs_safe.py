from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
UPDATER = (ROOT / "scripts" / "update-img2threejs-safe.sh").read_text()
INSTALLER = (ROOT / "scripts" / "install-img2threejs-auto-update.sh").read_text()


def test_updater_is_patch_only_and_requires_review_for_breaking_releases():
    assert '"${current%.*}" == "${candidate%.*}"' in UPDATER
    assert "review_required" in UPDATER


def test_updater_stages_all_official_components_before_promotion():
    for repo in ("img2threejs.git", "img2.git", "plugin-character.git", "plugin-cs2.git"):
        assert repo in UPDATER
    assert 'mktemp -d /tmp/render-img2-update.' in UPDATER
    assert 'rsync -a --delete --exclude .git "${stage}/img2threejs/" "$SKILL/"' in UPDATER


def test_updater_gates_regular_beta_and_rolls_back_on_failure():
    for gate in (
        "forge/tests",
        "plugin-character",
        "plugin-cs2",
        "test_mesh_img2_runtime.py",
        "test_mesh_pipeline_acceptance.py",
        "rolled_back",
    ):
        assert gate in UPDATER


def test_installer_schedules_daily_launch_agent():
    assert "img2threejs-update.plist.template" in INSTALLER
    assert "launchctl bootstrap" in INSTALLER
