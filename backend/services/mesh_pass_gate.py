"""Rejected Mesh passes never qualify for publication."""

from __future__ import annotations


def can_ship_exhausted_pass(*, glb_ok: bool, has_factory: bool) -> bool:
    return False


def exhausted_pass_note(pass_id: str, repair_brief: str, tries: int) -> str:
    brief = " ".join(str(repair_brief or "").split())
    note = (
        f"{pass_id} did not pass vision review after {tries} tries; "
        "the candidate was rejected and the accepted model was preserved."
    )
    if brief:
        return f"{note} Reviewer still wanted: {brief[:900]}"
    return note
