"""Wipeable sandbox + intro pack (sample logs)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, HTTPException

from backend.services import agent_intro_service as intro

router = APIRouter()


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/api/ops/agent-intro/pack")
def pack():
    return intro.pack_info()


@router.post("/api/ops/agent-intro/sandbox/reset")
def reset():
    return intro.sandbox_reset()


@router.post("/api/ops/agent-intro/sandbox/run")
def run(body: dict = Body(default=None)):
    data = body or {}
    return _call(intro.sandbox_run, str(data.get("op") or "ping"), int(data.get("a") or 0), int(data.get("b") or 0))


@router.post("/api/ops/agent-intro/handshake")
def handshake(body: dict = Body(...)):
    return intro.handshake(str(body.get("agent") or ""), str(body.get("phrase") or ""))


@router.get("/api/ops/agent-intro/handshake")
def handshake_get():
    return intro.handshake_status()


@router.post("/api/ops/agent-intro/refpack/upload")
def refpack_upload(body: dict = Body(...)):
    return _call(intro.refpack_upload, str(body.get("agent") or ""), str(body.get("src") or ""))
