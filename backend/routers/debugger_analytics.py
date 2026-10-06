"""Debugger analytics routes. Super-admin for mutations; harness key for ping/scores."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Request

from backend.auth import get_current_user, get_current_user_optional
from backend.services import debugger_analytics_service as das
from backend.services import platform_roles_service
from backend.services import prompt_trace_service as trace

router = APIRouter()


def _admin(user: dict[str, Any] | None) -> None:
    if not user or not platform_roles_service.is_super_admin(user):
        raise HTTPException(403, "Debugger analytics mutations are only available to the super admin.")


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


def _super_admin_not_harness(request: Request, user: dict[str, Any] | None) -> None:
    """Candidate confirm/reject is Sam's session only. Harness cannot close the CAD loop."""
    try:
        trace.require_agent_key(request)
    except HTTPException:
        pass
    else:
        raise HTTPException(403, "Harness cannot confirm or reject candidate jobs.")
    if not user:
        raise HTTPException(401, "Super-admin session required.")
    _admin(user)


def _harness_or_admin(request: Request, user: dict[str, Any] | None) -> str:
    try:
        trace.require_agent_key(request)
        return "harness"
    except HTTPException:
        if user and platform_roles_service.is_super_admin(user):
            return "admin"
        raise HTTPException(401, "Harness token or super-admin session required.")


CLIENT_STAMP_FEATURES = frozenset({
    "webgl.context",
    "memory.leak",
    "system.ram",
    "viewport.boot",
    "vr.controllers",
    "vr.controllers.trigger",
})
CLIENT_STAMP_PREFIXES = ("network.", "vr.controllers")


def client_stamp_allowed(feature: str, *, super_admin: bool = False) -> bool:
    if super_admin:
        return True
    fid = str(feature or "").strip().lower()
    if not fid:
        return False
    if fid in CLIENT_STAMP_FEATURES:
        return True
    return any(fid.startswith(prefix) for prefix in CLIENT_STAMP_PREFIXES)


def _harness_or_user(request: Request, user: dict[str, Any] | None) -> str:
    try:
        trace.require_agent_key(request)
        return "harness"
    except HTTPException:
        if user and user.get("id"):
            return "user"
        raise HTTPException(401, "Login or harness token required to stamp incidents.")


def require_incident_stamp(request: Request, user: dict[str, Any] | None, feature: str) -> str:
    actor = _harness_or_user(request, user)
    admin = bool(user and platform_roles_service.is_super_admin(user))
    if not client_stamp_allowed(feature, super_admin=admin):
        raise HTTPException(403, "Feature is not a client-smoke stamp.")
    return actor


@router.get("/api/ops/debugger-analytics/overview")
def overview(user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return das.overview()


@router.get("/api/ops/debugger-analytics/search")
def search(q: str = "", limit: int = 40, user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return _call(das.search_ids, q, limit=limit)


@router.get("/api/ops/debugger-analytics/inbox")
def inbox(user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return das.inbox()


@router.get("/api/ops/debugger-analytics/weekly")
def weekly(week_start: str | None = None, user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return _call(das.weekly_report, week_start)


@router.get("/api/ops/debugger-analytics/cli")
def list_cli(user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return {"requests": das.list_cli()}


@router.post("/api/ops/debugger-analytics/cli")
def request_cli(body: dict = Body(...), user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return _call(das.request_cli, body)


@router.put("/api/ops/debugger-analytics/cli/{cli_id}")
def update_cli(cli_id: str, body: dict = Body(...), user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    action = str(body.get("action") or body.get("status") or "approve")
    if action == "run":
        return _call(das.run_cli, cli_id)
    return _call(das.approve_cli, cli_id, approve=action != "deny")


@router.get("/api/ops/debugger-analytics/watchdogs")
def list_watchdogs(user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return {"watchdogs": das.list_watchdogs()}


@router.post("/api/ops/debugger-analytics/watchdogs")
def create_watchdog(body: dict = Body(...), user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return _call(das.draft_watchdog, body)


@router.get("/api/ops/debugger-analytics/watchdogs/{wid}")
def get_watchdog(wid: str, user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    row = das.get_watchdog(wid)
    if not row:
        raise HTTPException(404, "Watchdog not found")
    return row


@router.put("/api/ops/debugger-analytics/watchdogs/{wid}")
def update_watchdog(wid: str, body: dict = Body(...), user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    action = str(body.get("action") or body.get("status") or "approve")
    if action == "start":
        return _call(das.start_watchdog, wid)
    if action == "throttle":
        return _call(das.throttle_watchdog, wid, cause=str(body.get("cause") or "manual"))
    if action == "usage":
        return _call(das.record_usage, wid, bytes_n=int(body.get("bytes") or 0), requests=int(body.get("requests") or 1), seconds=float(body.get("seconds") or 1))
    if action == "prune":
        return _call(das.prune_watchdog, wid)
    if action == "helped":
        return _call(das.mark_watchdog_helped, wid)
    if action == "retire":
        return _call(das.approve_watchdog, wid, approve=False)
    return _call(das.approve_watchdog, wid, approve=action != "deny")


@router.post("/api/ops/debugger-analytics/analysis")
def analysis(body: dict = Body(...), user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return _call(das.post_analysis, body)


@router.get("/api/ops/debugger-analytics/analysis")
def list_analysis(user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return {"analysis": das.list_analysis()}


@router.post("/api/ops/debugger-analytics/notes")
def notes(body: dict = Body(...), user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return _call(das.post_note, body)


@router.get("/api/ops/debugger-analytics/notes")
def list_notes(user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return {"notes": das.list_notes()}


@router.get("/api/ops/debugger-analytics/bugs")
def list_bugs(user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return {"bugs": das.list_bugs()}


@router.post("/api/ops/debugger-analytics/bugs")
def create_bug(body: dict = Body(...), user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return _call(das.create_bug, body)


@router.get("/api/ops/debugger-analytics/bugs/{bug_id}")
def get_bug(bug_id: str, user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    row = das.get_bug(bug_id)
    if not row:
        raise HTTPException(404, "Bug not found")
    return row


@router.get("/api/ops/debugger-analytics/bugs/{bug_id}/instances")
def ping_bug(bug_id: str, request: Request, user: dict[str, Any] | None = Depends(get_current_user_optional)):
    _harness_or_admin(request, user)
    return _call(das.ping_bug, bug_id)


@router.post("/api/ops/debugger-analytics/bugs/{bug_id}/instances")
def report_bug_instance(bug_id: str, request: Request, body: dict = Body(...), user: dict[str, Any] | None = Depends(get_current_user_optional)):
    _harness_or_admin(request, user)
    return _call(das.report_instance, bug_id, body)


@router.post("/api/ops/debugger-analytics/skills")
def propose_skill(body: dict = Body(...), user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return _call(das.propose_skill, body)


@router.get("/api/ops/debugger-analytics/skills")
def list_skills(user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return {"proposals": das.list_skill_proposals()}


@router.put("/api/ops/debugger-analytics/skills/{sid}")
def update_skill(sid: str, body: dict = Body(...), user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    action = str(body.get("action") or "approve")
    if action == "confirm":
        return _call(das.confirm_skill_solve, sid, breakage=int(body.get("breakage") or 0))
    if action == "apply":
        return _call(das.apply_skill, sid)
    return _call(das.approve_skill, sid)


@router.get("/api/ops/debugger-analytics/scores")
def list_scores(request: Request, user: dict[str, Any] | None = Depends(get_current_user_optional), limit: int = 40):
    _harness_or_admin(request, user)
    rows = das.list_scores(limit)
    compact = [{"id": r["id"], "log_id": r.get("log_id"), "score": r["score"], "label": r["label"], "tracking_id": r.get("tracking_id"), "result_ref": r.get("result_ref"), "ts": r["ts"]} for r in rows]
    return {"scores": compact}


@router.get("/api/ops/debugger-analytics/swarm-summary")
def swarm_summary(request: Request, user: dict[str, Any] | None = Depends(get_current_user_optional)):
    """Read-only period/501/league/jobs proof. Same auth as GET /scores. Not overview."""
    _harness_or_admin(request, user)
    return _swarm().swarm_summary()


@router.post("/api/ops/debugger-analytics/scores")
def create_score(request: Request, body: dict = Body(...), user: dict[str, Any] | None = Depends(get_current_user_optional)):
    _harness_or_admin(request, user)
    return _call(das.record_score, body)


@router.get("/api/ops/debugger-analytics/refs/{ref_id}")
def get_ref(ref_id: str, request: Request, user: dict[str, Any] | None = Depends(get_current_user_optional)):
    _harness_or_admin(request, user)
    row = das.get_ref(ref_id)
    if not row:
        raise HTTPException(404, "Reference not found")
    return {"id": row["id"], "kind": row["kind"], "composite": row["composite"], "members": row.get("members") or [], "extra": row.get("extra") or {}}


@router.get("/api/ops/debugger-analytics/throttle")
def throttle_status(user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return das.global_throttle_snapshot()


def _priv():
    from backend.services import debugger_privilege_service as dps
    return dps


@router.get("/api/ops/debugger-analytics/privileges")
def list_privileges(user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return {"privileges": _priv().list_privileges(), "ask_safe": _priv().list_ask_safe(), "formula": _priv().FORMULA}


@router.post("/api/ops/debugger-analytics/privileges/ask-safe")
def ask_safe(body: dict = Body(...), user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return _call(_priv().ask_to_mark_safe, str(body.get("method") or ""), note=str(body.get("note") or ""))


@router.put("/api/ops/debugger-analytics/privileges/{method}")
def update_privilege(method: str, body: dict = Body(...), user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    action = str(body.get("action") or "safe")
    if action == "ban":
        return _call(_priv().ban_privilege, method, reason=str(body.get("reason") or ""))
    if action == "restrict":
        return _call(_priv().restrict_privilege, method, reason=str(body.get("reason") or ""))
    return _call(_priv().mark_safe, method)


@router.get("/api/ops/debugger-analytics/forks")
def list_forks(user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return {"forks": _priv().list_forks()}


@router.post("/api/ops/debugger-analytics/forks")
def create_fork(body: dict = Body(...), user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return _call(_priv().create_fork, body)


@router.put("/api/ops/debugger-analytics/forks/{fork_id}")
def update_fork(fork_id: str, body: dict = Body(...), user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return _call(_priv().evaluate_fork, fork_id, body.get("scores_after"))


@router.get("/api/ops/debugger-analytics/rollbacks")
def list_rollbacks(user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return {"rollbacks": _priv().list_rollbacks()}


@router.post("/api/ops/debugger-analytics/rollbacks")
def create_rollback(body: dict = Body(...), user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return _call(_priv().propose_rollback, body)


@router.put("/api/ops/debugger-analytics/rollbacks/{rid}")
def update_rollback(rid: str, body: dict = Body(...), user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return _call(_priv().approve_rollback, rid, approve=str(body.get("action") or "approve") != "deny")


@router.post("/api/ops/debugger-analytics/issues")
def create_issue(body: dict = Body(...), user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return _call(_priv().file_issue, body)


@router.put("/api/ops/debugger-analytics/issues/{issue_id}")
def update_issue(issue_id: str, body: dict = Body(...), user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    approve = str(body.get("action") or "approve") != "deny"
    github = body.get("github") is not False
    return _call(_priv().approve_issue, issue_id, approve=approve, github=github)


@router.get("/api/ops/debugger-analytics/issues")
def list_issues(user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return {"issues": _priv().list_issues()}


@router.get("/api/ops/debugger-analytics/logic")
def logic_report(scope: str = "weekly", user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return _call(_priv().logic_report, scope)


@router.post("/api/ops/debugger-analytics/agent-score")
def agent_score(request: Request, body: dict = Body(...), user: dict[str, Any] | None = Depends(get_current_user_optional)):
    _harness_or_admin(request, user)
    from backend.services.render_agent_debug_adapter import record_agent_score
    return _call(record_agent_score, body)


def _cost():
    from backend.services import debugger_cost_service as dcs
    return dcs


@router.get("/api/ops/debugger-analytics/cost-reports")
def list_cost_reports(user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return {"reports": _cost().list_reports(), "latest": _cost().latest(), "totals": _cost().weekly_addon().get("cost_totals")}


@router.get("/api/ops/debugger-analytics/cost-reports/latest")
def latest_cost_report(user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    row = _cost().latest()
    if not row:
        return {"report": None, "team_line": ""}
    return {"report": row, "team_line": row.get("team_line") or "", "speak": row.get("speak") or ""}


@router.get("/api/ops/debugger-analytics/cost-reports/{rid}")
def get_cost_report(rid: str, user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    row = _cost().get_report(rid)
    if not row:
        raise HTTPException(404, "cost report not found")
    return row


@router.post("/api/ops/debugger-analytics/sessions")
def open_debug_session(request: Request, body: dict = Body(...), user: dict[str, Any] | None = Depends(get_current_user_optional)):
    _harness_or_admin(request, user)
    return _call(_cost().open_session, body)


@router.post("/api/ops/debugger-analytics/sessions/close")
def close_debug_session(request: Request, body: dict = Body(...), user: dict[str, Any] | None = Depends(get_current_user_optional)):
    _harness_or_admin(request, user)
    payload = dict(body or {})
    payload.setdefault("trigger", "close")
    return _call(_cost().close_session, payload)


@router.post("/api/ops/debugger-analytics/sessions/cede")
def cede_debug_session(request: Request, body: dict = Body(...), user: dict[str, Any] | None = Depends(get_current_user_optional)):
    _harness_or_admin(request, user)
    payload = dict(body or {})
    payload["trigger"] = "cede"
    return _call(_cost().close_session, payload)


def _metrics():
    from backend.services import debugger_metrics_service as dms
    return dms


@router.get("/api/ops/debugger-analytics/metrics")
def metrics_overview(user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return _metrics().overview_addon()


@router.get("/api/ops/debugger-analytics/taxonomy")
def taxonomy(user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return _metrics().taxonomy()


@router.get("/api/ops/debugger-analytics/latency")
def list_latency(user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return {"latency": _metrics().list_latency()}


@router.post("/api/ops/debugger-analytics/latency")
def create_latency(request: Request, body: dict = Body(...), user: dict[str, Any] | None = Depends(get_current_user_optional)):
    _harness_or_admin(request, user)
    return _call(_metrics().record_latency, body)


@router.get("/api/ops/debugger-analytics/users")
def list_debug_users(user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return {"users": _metrics().list_user_scores()}


@router.get("/api/ops/debugger-analytics/users/{user_id}")
def get_debug_user(user_id: str, user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    row = _metrics().get_user_score(user_id)
    if not row:
        raise HTTPException(404, "debug user score not found")
    return row


@router.get("/api/ops/debugger-analytics/actor-scores")
def actor_scores(actor: str | None = None, user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return {"scores": _metrics().list_actor_scores(actor)}


@router.post("/api/ops/debugger-analytics/confirm-fixed")
def confirm_fixed(request: Request, body: dict = Body(...), user: dict[str, Any] | None = Depends(get_current_user_optional)):
    _harness_or_admin(request, user)
    return _call(_metrics().confirm_fixed, body)


@router.get("/api/ops/debugger-analytics/confirm-fixed")
def list_confirm_fixed(user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return {"confirms": _metrics().list_confirms()}


@router.get("/api/ops/debugger-analytics/suggestions")
def list_suggestions(status: str | None = None, user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return {"suggestions": _metrics().list_suggestions(status)}


@router.post("/api/ops/debugger-analytics/suggestions")
def create_suggestion(body: dict = Body(...), user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return _call(_metrics().create_suggestion, body)


@router.put("/api/ops/debugger-analytics/suggestions/{sid}")
def update_suggestion(sid: str, body: dict = Body(...), user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return _call(
        _metrics().decide_suggestion,
        sid,
        action=str(body.get("action") or "take"),
        note=str(body.get("note") or ""),
        fork_id=str(body.get("fork_id") or ""),
        outcome_after=body.get("outcome_after"),
    )


@router.get("/api/ops/debugger-analytics/blacklist")
def list_blacklist(user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return {"blacklist": _metrics().list_blacklist()}


@router.post("/api/ops/debugger-analytics/blacklist")
def create_blacklist(body: dict = Body(...), user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return _call(_metrics().note_blacklist_hit, str(body.get("method") or ""), damage=int(body.get("damage") or 40), leak=bool(body.get("leak")), reason=str(body.get("reason") or ""))


@router.put("/api/ops/debugger-analytics/blacklist/{method}")
def update_blacklist(method: str, body: dict = Body(...), user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    if str(body.get("action") or "restore") != "restore":
        raise HTTPException(400, "only restore is allowed; blacklist is automatic")
    return _call(_metrics().restore_blacklist, method)


@router.post("/api/ops/debugger-analytics/watchdogs/{wid}/archive")
def archive_watchdog(wid: str, body: dict | None = Body(None), user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    data = body or {}
    if data.get("finish"):
        return _call(_metrics().finish_watchdog, wid, worked=bool(data.get("worked")))
    return _call(_metrics().archive_watchdog, wid, worked=bool(data.get("worked")), upload_drive=bool(data.get("upload_drive")))


def _swarm():
    from backend.services import debugger_swarm_service as dss
    return dss


@router.get("/api/ops/debugger-analytics/history")
def history_search(request: Request, q: str = "", limit: int = 20, offset: int = 0, user: dict[str, Any] | None = Depends(get_current_user_optional)):
    _harness_or_admin(request, user)
    return _call(_swarm().history_search, q, limit=limit, offset=offset)


@router.get("/api/ops/debugger-analytics/history/{log_id}")
def history_get(log_id: str, request: Request, user: dict[str, Any] | None = Depends(get_current_user_optional)):
    _harness_or_admin(request, user)
    return _call(_swarm().history_get, log_id)


@router.post("/api/ops/debugger-analytics/cli/readonly")
def readonly_cli(body: dict = Body(...), user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return _call(_swarm().request_readonly_cli, body)


@router.get("/api/ops/debugger-analytics/catalog")
def catalog(user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return _swarm().catalog()


@router.post("/api/ops/debugger-analytics/agree")
def agree_catalog(body: dict = Body(...), user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return _call(_swarm().agree, body)


@router.get("/api/ops/debugger-analytics/credit")
def list_credit(period: str | None = None, user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return {"credits": _swarm().list_credit(period), "periods": list(_swarm().CREDIT_PERIODS), "categories": list(_swarm().CREDIT_CATEGORIES)}


@router.post("/api/ops/debugger-analytics/credit")
def create_credit(request: Request, body: dict = Body(...), user: dict[str, Any] | None = Depends(get_current_user_optional)):
    _harness_or_admin(request, user)
    return _call(_swarm().record_credit, body)


@router.get("/api/ops/debugger-analytics/credit/rollup")
def credit_rollup(period: str = "weekly", all_periods: bool = False, user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    if all_periods:
        return _swarm().rollup_all_periods()
    return _call(_swarm().rollup_credit, period)


@router.get("/api/ops/debugger-analytics/instance-users")
def instance_users(user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return {"users": _swarm().list_instance_users(), "area": _swarm().LOCAL_AREA}


@router.get("/api/ops/debugger-analytics/instance-registry")
def instance_registry(q: str = "", user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    if q in {"list", "*"}:
        return {"instances": _swarm().list_instances(), "how": _swarm().INSTANCE_REGISTRY_HOW, "vector_db": False}
    return _swarm().resolve_instance({"q": q or _swarm().LOCAL_AREA})


@router.post("/api/ops/debugger-analytics/instance-users")
def register_instance_user(body: dict = Body(...), user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return _call(_swarm().register_user, body)


@router.post("/api/ops/debugger-analytics/league/cycle")
def league_cycle(body: dict = Body(...), user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return _call(_swarm().league_cycle, body)


@router.get("/api/ops/debugger-analytics/league")
def league(user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return {"league": _swarm().list_league(), "underperform": _swarm().underperformers(), "reports": _swarm().list_reports()}


@router.post("/api/ops/debugger-analytics/debug-jobs/{job_id}/confirm-candidate")
@router.put("/api/ops/debugger-analytics/debug-jobs/{job_id}/confirm-candidate")
def confirm_candidate_job(
    job_id: str,
    request: Request,
    body: dict | None = Body(None),
    user: dict[str, Any] | None = Depends(get_current_user_optional),
):
    _super_admin_not_harness(request, user)
    payload = dict(body or {})
    payload["job_id"] = job_id
    return _call(_swarm().confirm_candidate, payload)


@router.post("/api/ops/debugger-analytics/debug-jobs/{job_id}/reject-candidate")
@router.put("/api/ops/debugger-analytics/debug-jobs/{job_id}/reject-candidate")
def reject_candidate_job(
    job_id: str,
    request: Request,
    body: dict | None = Body(None),
    user: dict[str, Any] | None = Depends(get_current_user_optional),
):
    _super_admin_not_harness(request, user)
    payload = dict(body or {})
    payload["job_id"] = job_id
    return _call(_swarm().reject_candidate, payload)


@router.put("/api/ops/debugger-analytics/league/report/{rid}")
def league_report_decide(rid: str, body: dict = Body(...), user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return _call(_swarm().decide_report, rid, body)


@router.post("/api/ops/debugger-analytics/league/report")
def league_report(body: dict = Body(...), user: dict[str, Any] = Depends(get_current_user)):
    _admin(user)
    return _call(_swarm().report_agent, body)
