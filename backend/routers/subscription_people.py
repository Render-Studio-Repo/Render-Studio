"""Personal Claude subscription grants; authentication stays with the owner."""
import math

from fastapi import APIRouter, Body, Depends, HTTPException

from backend.auth import get_current_user
from backend.services import personal_subscription_share_service as shares

router = APIRouter(prefix="/api/ai-subscriptions/claude/people")


def _limit(body):
    raw = body.get("daily_limit_usd")
    if raw in (None, ""):
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError) as exc:
        raise HTTPException(400, "Daily limit must be a number") from exc
    if not math.isfinite(value) or value < 0:
        raise HTTPException(400, "Daily limit must be a finite nonnegative number")
    return value


def _notify(owner, recipient):
    from backend.main import _notify_ai_keys_changed

    _notify_ai_keys_changed([owner, recipient], reason="claude_access_changed")


@router.get("")
def list_people(user=Depends(get_current_user)):
    return {"people": shares.list_personal_people(user["id"], "claude")}


@router.post("")
def add_person(body: dict = Body({}), user=Depends(get_current_user)):
    limit = _limit(body)
    try:
        result = shares.add_personal_person(
            user["id"], "claude", email=body.get("email"), handle=body.get("handle"),
            user_id=body.get("user_id") or body.get("id"), daily_limit_usd=limit,
            confirm_new_collaborator=bool(body.get("confirm_new_collaborator")),
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    person = result.get("person") or {}
    if result.get("status") == "added" and person.get("user_id"):
        _notify(user["id"], person["user_id"])
    return {**result, "people": shares.list_personal_people(user["id"], "claude")}


@router.put("/{target_user_id}")
def update_person(target_user_id: str, body: dict = Body({}), user=Depends(get_current_user)):
    limit = _limit(body)
    try:
        people = shares.set_personal_person_access(
            user["id"], "claude", target_user_id,
            granted=bool(body["granted"]) if "granted" in body else None,
            daily_limit_usd=limit, daily_limit_provided="daily_limit_usd" in body,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    _notify(user["id"], target_user_id)
    return {"people": people}


@router.delete("/{target_user_id}")
def remove_person(target_user_id: str, user=Depends(get_current_user)):
    try:
        result = shares.remove_personal_person(user["id"], "claude", target_user_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    _notify(user["id"], target_user_id)
    return {**result, "people": shares.list_personal_people(user["id"], "claude")}
