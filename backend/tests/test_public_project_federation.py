from backend.services.public_project_federation import public_pin_hub_action


def test_existing_public_project_pin_changes_stay_on_the_local_instance() -> None:
    assert public_pin_hub_action(was_public=True, pinned=True) == "local-only"
    assert public_pin_hub_action(was_public=True, pinned=False) == "local-only"


def test_first_public_pin_submits_the_new_public_project_to_the_hub() -> None:
    assert public_pin_hub_action(was_public=False, pinned=True) == "publish"
