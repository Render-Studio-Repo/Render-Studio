"""Public vision desk: white paper comments, agent asks, census, credit."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, HTTPException, Request

from backend.services import vision_desk_service as desk

router = APIRouter()


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/api/ops/vision-desk/comments")
def comments_get(limit: int = 40):
    return {"comments": desk.list_comments(limit)}


@router.post("/api/ops/vision-desk/comments")
def comments_post(request: Request, body: dict = Body(default=None)):
    data = body or {}
    ip = request.client.host if request.client else ""
    return _call(desk.add_comment, str(data.get("body") or ""), data.get("name"), ip)


@router.post("/api/ops/vision-desk/ask")
def ask(body: dict = Body(default=None)):
    data = body or {}
    return _call(desk.ask_agent, str(data.get("text") or ""), str(data.get("session_id") or ""))


@router.get("/api/ops/vision-desk/stats")
def stats():
    return desk.stats()


@router.get("/api/ops/vision-desk/census")
def census():
    return desk.census()


@router.get("/api/ops/vision-desk/credit")
def credit():
    return desk.credit_score()


@router.post("/api/ops/vision-desk/markup")
def markup(body: dict = Body(default=None)):
    data = body or {}
    return desk.save_markup(str(data.get("note") or ""), str(data.get("image") or ""))


@router.post("/api/ops/vision-desk/hello")
def hello(body: dict = Body(default=None)):
    data = body or {}
    return desk.record_hello(str(data.get("agent") or ""), str(data.get("text") or ""))


@router.get("/api/ops/vision-desk/ranking")
def ranking():
    return desk.ranking_from_hellos()


@router.post("/api/ops/vision-desk/tasks")
def task(body: dict = Body(default=None)):
    data = body or {}
    return desk.create_task(str(data.get("agent") or "unknown"), str(data.get("detail") or ""))
