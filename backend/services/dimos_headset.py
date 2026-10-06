"""Headset id → DIMOS `dimos run teleop-*` blueprint.

Dimos ships `teleop-quest-*` only. Vision Pro and Vive/Index fall back to
`teleop-quest-openarm` (same :8443 /ws LCM PoseStamped + Joy pipe).
"""

from __future__ import annotations

DEFAULT_BLUEPRINT = "teleop-quest-openarm"
ALLOWED_BLUEPRINTS = frozenset({DEFAULT_BLUEPRINT})
ALLOWED_HEADSETS = frozenset({"quest", "vision", "vive"})

HEADSET_BLUEPRINTS: dict[str, str] = {
    "quest": DEFAULT_BLUEPRINT,
    "vision": DEFAULT_BLUEPRINT,
    "vive": DEFAULT_BLUEPRINT,
}

FALLBACK_NOTES: dict[str, str] = {
    "vision": (
        "dimos has no teleop-vision-* blueprint; Vision Pro uses "
        "teleop-quest-openarm (same /ws LCM pipe)."
    ),
    "vive": (
        "dimos has no teleop-vive-* blueprint; Vive/Index uses "
        "teleop-quest-openarm (same /ws LCM pipe)."
    ),
}


def normalize_headset(headset: str | None) -> str:
    key = str(headset or "").strip().lower()
    if key in ALLOWED_HEADSETS:
        return key
    return "quest"


def resolve_headset_blueprint(
    headset: str | None,
    blueprint: str | None = None,
) -> tuple[str, str, str]:
    hid = normalize_headset(headset)
    mapped = HEADSET_BLUEPRINTS.get(hid, DEFAULT_BLUEPRINT)
    note = FALLBACK_NOTES.get(hid, "")
    requested = str(blueprint or "").strip()
    if requested in ALLOWED_BLUEPRINTS:
        return hid, requested, note
    return hid, mapped, note


def headset_map_payload() -> dict[str, object]:
    return {
        "blueprints": dict(HEADSET_BLUEPRINTS),
        "fallback": DEFAULT_BLUEPRINT,
        "notes": dict(FALLBACK_NOTES),
        "allowed": sorted(ALLOWED_BLUEPRINTS),
    }
