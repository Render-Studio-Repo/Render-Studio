from __future__ import annotations

from typing import Literal


PublicPinHubAction = Literal["publish", "local-only"]


def public_pin_hub_action(*, was_public: bool, pinned: bool) -> PublicPinHubAction:
    """Keep curation local unless pinning is also the initial publication."""
    if pinned and not was_public:
        return "publish"
    return "local-only"
