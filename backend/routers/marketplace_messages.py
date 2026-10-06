"""Authenticated direct messaging; every request derives its sender from auth."""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from backend.auth import get_current_user
from backend.services import marketplace_messages_service as messages

router=APIRouter()


class MessageBody(BaseModel):
    body: str = Field(min_length=1,max_length=4000)


class BlockBody(BaseModel):
    blocked: bool


def _call(fn,*args):
    try:return fn(*args)
    except KeyError as exc:raise HTTPException(404,str(exc).strip("'")) from exc
    except PermissionError as exc:raise HTTPException(403,str(exc)) from exc
    except messages.MessageLimit as exc:raise HTTPException(429,str(exc)) from exc
    except ValueError as exc:raise HTTPException(400,str(exc)) from exc


@router.get("/api/marketplace/messages")
def inbox(user=Depends(get_current_user)):
    return messages.inbox(user["id"])


@router.get("/api/marketplace/messages-unread")
def unread(user=Depends(get_current_user)):
    return messages.unread(user["id"])


@router.get("/api/marketplace/messages/{peer_id}")
def conversation(peer_id:str,before:str=Query(default="",max_length=60),user=Depends(get_current_user)):
    return _call(messages.conversation,user["id"],peer_id,before)


@router.post("/api/marketplace/messages/{peer_id}")
def send(peer_id:str,body:MessageBody,user=Depends(get_current_user)):
    return _call(messages.send,user["id"],peer_id,body.body)


@router.put("/api/marketplace/messages/{peer_id}/block")
def block(peer_id:str,body:BlockBody,user=Depends(get_current_user)):
    return _call(messages.set_block,user["id"],peer_id,body.blocked)
