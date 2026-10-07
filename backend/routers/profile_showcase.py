"""Separate public-profile presentation APIs; identity and social policies remain existing."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from backend.auth import get_current_user, get_current_user_optional
from backend.services import profile_service, profile_showcase_service as showcase

router = APIRouter()


class ShowcaseBody(BaseModel):
    showcase: dict
    revision: int = Field(ge=0)


class PinBody(BaseModel):
    kind: str = Field(max_length=20)
    listing_id: str = Field(min_length=1, max_length=100)
    category: str = Field(default="", max_length=48)


def _owner(user):
    owner = profile_service.get_user_row(user["id"])
    if not owner:
        raise HTTPException(404, "Profile not found.")
    return owner


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except showcase.RevisionConflict as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/api/marketplace/profile/{handle}/showcase")
def public_showcase(handle: str, user=Depends(get_current_user_optional)):
    owner = profile_service.get_user_row(handle=handle)
    if not owner:
        raise HTTPException(404, "Profile not found.")
    return showcase.payload(owner, viewer=user)


@router.get("/api/marketplace/profile-showcase/me")
def own_showcase(user=Depends(get_current_user)):
    return showcase.payload(_owner(user), viewer=user)


@router.put("/api/marketplace/profile-showcase/me")
def save_showcase(body: ShowcaseBody, user=Depends(get_current_user)):
    return _call(showcase.save, _owner(user), body.showcase, body.revision)


@router.post("/api/marketplace/profile-showcase/me/pins")
def pin_showcase(body: PinBody, user=Depends(get_current_user)):
    return _call(showcase.pin, _owner(user), body.kind, body.listing_id, body.category)
