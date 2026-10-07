"""Thin Render Agent adapter: same tracking ids / scores as Grok debugger-analytics.

Does not invent a second id scheme. Posts through debugger_analytics_service.record_score.
"""
from __future__ import annotations

from typing import Any

from backend.services import debugger_analytics_service as das
from backend.services.debugger_privilege_service import compose_project_id, instance_project_member


def tracking_ids(
    *,
    project_id: str,
    instance_id: str | None = None,
    log_ids: list[str] | None = None,
    prompt_ids: list[str] | None = None,
    traceback_ids: list[str] | None = None,
) -> dict[str, Any]:
    composed = compose_project_id(project_id, instance_id)
    members: list[dict[str, str]] = [instance_project_member(project_id, instance_id)]
    for lid in log_ids or []:
        if das.MEMBER_ID_RE.fullmatch(str(lid)):
            members.append({"kind": "log", "id": str(lid)})
    for pid in prompt_ids or []:
        if das.MEMBER_ID_RE.fullmatch(str(pid)):
            members.append({"kind": "prompt", "id": str(pid)})
    for tb in traceback_ids or []:
        if das.MEMBER_ID_RE.fullmatch(str(tb)):
            members.append({"kind": "tb", "id": str(tb)})
    composite = das.encode_tracking_id(members)
    return {
        "project_id": composed,
        "instance_id": instance_id or "",
        "tracking_id": composite,
        "members": members,
        "log_ids": list(log_ids or []),
    }


def record_agent_score(data: dict[str, Any]) -> dict[str, Any]:
    project_id = str(data.get("project_id") or data.get("project") or "").strip()
    if not project_id:
        raise ValueError("Render Agent score needs project_id")
    instance_id = str(data.get("instance_id") or "").strip() or None
    ids = tracking_ids(
        project_id=project_id,
        instance_id=instance_id,
        log_ids=data.get("log_ids") or ([data["log_id"]] if data.get("log_id") else []),
        prompt_ids=data.get("prompt_ids") or ([data["prompt_id"]] if data.get("prompt_id") else []),
        traceback_ids=data.get("traceback_ids"),
    )
    payload = dict(data)
    payload["project_id"] = ids["project_id"]
    payload["project_ids"] = [ids["project_id"]]
    payload.setdefault("source", "render-agent")
    scored = das.record_score(payload)
    scored["tracking_id"] = scored.get("tracking_id") or ids["tracking_id"]
    scored["project_id"] = ids["project_id"]
    return scored


def maybe_record_turn(thread: dict[str, Any], messages: list[dict[str, Any]], *, user_id: str = "") -> dict[str, Any] | None:
    """If a Render Agent turn includes score / debug fields, write the shared analytics row."""
    interesting = [m for m in messages if isinstance(m, dict) and (m.get("score") is not None or m.get("debug_improve") or m.get("tracking_id") or m.get("project_id"))]
    if not interesting:
        job = attach_claimed_debug_job(thread)
        return {"debug_job": job, "cursor_packet": thread.get("cursor_packet")} if job else None
    last = interesting[-1]
    project_id = str(last.get("project_id") or thread.get("project_id") or "")
    if not project_id:
        job = attach_claimed_debug_job(thread)
        return {"debug_job": job, "cursor_packet": thread.get("cursor_packet")} if job else None
    try:
        scored = record_agent_score({
            "project_id": project_id,
            "instance_id": last.get("instance_id") or thread.get("instance_id"),
            "log_id": last.get("log_id") or last.get("id"),
            "prompt_id": last.get("prompt_id"),
            "score": last.get("score"),
            "features": last.get("features") or last.get("system_check") or {},
            "broken": last.get("broken") or [],
            "fixed": last.get("fixed") or [],
            "steps": last.get("steps") or [],
            "method": last.get("method"),
            "notes": str(last.get("content") or last.get("notes") or "")[:120],
            "traceback_ids": last.get("traceback_ids"),
        })
    except ValueError:
        return None
    thread["debug_tracking_id"] = scored.get("tracking_id")
    thread["debug_project_id"] = scored.get("project_id")
    thread["debug_score_id"] = scored.get("id")
    job = attach_claimed_debug_job(thread)
    if job:
        scored["debug_job_id"] = job.get("id")
        scored["debug_job_tracking_id"] = job.get("tracking_id")
        scored.setdefault("tracking_id", job.get("tracking_id"))
        scored["cursor_packet"] = thread.get("cursor_packet")
    return scored


def attach_claimed_debug_job(thread: dict[str, Any], *, agent_id: str = "render-agent") -> dict[str, Any] | None:
    """Copy claimed job tracking ids onto a Render Agent thread. Does not claim."""
    try:
        from backend.services import debugger_swarm_service as dss
    except Exception:
        return None
    jobs = dss.list_debug_jobs(8, status="claimed")
    if not jobs:
        return None
    preferred = [j for j in jobs if str(j.get("agent_id") or "") in {agent_id, "grok", "cursor", "render-agent"}]
    pool = preferred or jobs
    patchable = [j for j in pool if not dss.patch_claim_blocked(j)]
    job = (patchable or pool)[0]
    thread["debug_job_id"] = job.get("id")
    thread["debug_tracking_id"] = job.get("tracking_id") or thread.get("debug_tracking_id")
    thread["debug_last_working_id"] = job.get("last_working_id") or ""
    thread["debug_first_broken_id"] = job.get("first_broken_id") or ""
    thread["debug_log_path"] = job.get("log_path") or ""
    thread["cursor_packet"] = dss.debug_job_handoff_packet(job)
    blocked = dss.patch_claim_blocked(job)
    thread["patch_claim"] = not blocked
    if blocked == "replace_approach_guard":
        thread["replacement_brief"] = dss.replacement_brief(job)
    elif blocked == "pending_reload_guard":
        thread["reload_brief"] = dss.pending_reload_brief(job)
    return job
