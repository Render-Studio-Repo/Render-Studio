"""Create GitHub issues from Studio (feature requests). Server PAT only."""

from __future__ import annotations

from typing import Any

import httpx

from backend.config import settings

API = "https://api.github.com"
UA = {"Accept": "application/vnd.github+json", "User-Agent": "render-studio"}
FEATURE_REQUEST_LABEL = "feature-request"
INSTANCE_REPORT_LABEL = "instance-report"
DEFAULT_REPO = "wprojects/Render-Studio"


def issues_repo() -> str:
    return (settings.github_bugs_repo or "").strip() or DEFAULT_REPO


def _headers(token_override: str = "") -> dict[str, str] | None:
    token = (token_override or settings.github_token or "").strip()
    if not token:
        return None
    return {"Authorization": f"Bearer {token}", **UA}


def ensure_feature_request_label(repo: str) -> dict[str, Any]:
    headers = _headers()
    if not headers:
        return {"ok": False, "error": "github_not_configured"}
    resp = httpx.post(
        f"{API}/repos/{repo}/labels",
        headers=headers,
        json={
            "name": FEATURE_REQUEST_LABEL,
            "color": "1d76db",
            "description": "Admin-requested missing setting or feature",
        },
        timeout=15,
    )
    if resp.status_code in {200, 201}:
        return {"ok": True, "created": True}
    if resp.status_code == 422:
        return {"ok": True, "created": False}
    return {"ok": False, "error": resp.text[:240], "status": resp.status_code}


def create_feature_request_issue(*, title: str, body: str) -> dict[str, Any]:
    headers = _headers()
    repo = issues_repo()
    if not headers:
        return {"ok": False, "error": "github_not_configured", "repo": repo}
    ensure_feature_request_label(repo)
    resp = httpx.post(
        f"{API}/repos/{repo}/issues",
        headers=headers,
        json={
            "title": (title or "Feature request")[:200],
            "body": (body or "")[:12000],
            "labels": [FEATURE_REQUEST_LABEL],
        },
        timeout=20,
    )
    if resp.status_code == 422:
        resp = httpx.post(
            f"{API}/repos/{repo}/issues",
            headers=headers,
            json={"title": (title or "Feature request")[:200], "body": (body or "")[:12000]},
            timeout=20,
        )
    if resp.status_code >= 400:
        return {"ok": False, "error": resp.text[:240], "repo": repo, "status": resp.status_code}
    data = resp.json() if resp.content else {}
    return {
        "ok": True,
        "repo": repo,
        "number": data.get("number"),
        "html_url": data.get("html_url"),
        "label": FEATURE_REQUEST_LABEL,
    }


def create_debugger_issue(*, title: str, body: str) -> dict[str, Any]:
    """Optional GitHub note for debugger analytics. Same PAT as feature requests."""
    headers = _headers()
    repo = issues_repo()
    if not headers:
        return {"ok": False, "error": "github_not_configured", "repo": repo}
    resp = httpx.post(
        f"{API}/repos/{repo}/issues",
        headers=headers,
        json={"title": (title or "Debugger issue")[:200], "body": (body or "")[:12000], "labels": ["bug"]},
        timeout=20,
    )
    if resp.status_code == 422:
        resp = httpx.post(
            f"{API}/repos/{repo}/issues",
            headers=headers,
            json={"title": (title or "Debugger issue")[:200], "body": (body or "")[:12000]},
            timeout=20,
        )
    if resp.status_code >= 400:
        return {"ok": False, "error": resp.text[:240], "repo": repo, "status": resp.status_code}
    data = resp.json() if resp.content else {}
    return {"ok": True, "repo": repo, "number": data.get("number"), "html_url": data.get("html_url")}


def repository_work(*, limit: int = 100, token: str = "") -> dict[str, Any]:
    """Return issues and pull requests for the configured management repository."""
    headers = _headers(token)
    repo = issues_repo()
    read_headers = headers or UA
    try:
        resp = httpx.get(
            f"{API}/repos/{repo}/issues",
            headers=read_headers,
            params={"state": "all", "per_page": max(1, min(int(limit), 100)), "sort": "updated", "direction": "desc"},
            timeout=20,
        )
    except Exception as exc:
        return {"ok": False, "configured": True, "writable": bool(headers), "repo": repo, "error": type(exc).__name__, "issues": [], "pull_requests": []}
    if resp.status_code >= 400:
        return {"ok": False, "configured": True, "writable": bool(headers), "repo": repo, "error": resp.text[:240], "issues": [], "pull_requests": []}
    issues: list[dict[str, Any]] = []
    pulls: list[dict[str, Any]] = []
    for row in resp.json() or []:
        item = {
            "number": row.get("number"),
            "title": row.get("title"),
            "state": row.get("state"),
            "html_url": row.get("html_url"),
            "updated_at": row.get("updated_at"),
            "created_at": row.get("created_at"),
            "author": (row.get("user") or {}).get("login"),
            "labels": [label.get("name") for label in (row.get("labels") or []) if label.get("name")],
        }
        (pulls if row.get("pull_request") else issues).append(item)
    return {"ok": True, "configured": True, "writable": bool(headers), "repo": repo, "issues": issues, "pull_requests": pulls}


def create_instance_report_issue(*, title: str, body: str, token: str = "") -> dict[str, Any]:
    headers = _headers(token)
    repo = issues_repo()
    if not headers:
        return {"ok": False, "error": "github_not_configured", "repo": repo}
    resp = httpx.post(
        f"{API}/repos/{repo}/issues",
        headers=headers,
        json={"title": (title or "Instance report")[:200], "body": (body or "")[:12000], "labels": [INSTANCE_REPORT_LABEL]},
        timeout=20,
    )
    if resp.status_code == 422:
        resp = httpx.post(
            f"{API}/repos/{repo}/issues",
            headers=headers,
            json={"title": (title or "Instance report")[:200], "body": (body or "")[:12000]},
            timeout=20,
        )
    if resp.status_code >= 400:
        return {"ok": False, "error": resp.text[:240], "repo": repo, "status": resp.status_code}
    data = resp.json() if resp.content else {}
    return {"ok": True, "repo": repo, "number": data.get("number"), "html_url": data.get("html_url"), "state": data.get("state")}


def update_issue_state(number: int, state: str, *, token: str = "") -> dict[str, Any]:
    headers = _headers(token)
    repo = issues_repo()
    desired = "closed" if str(state).lower() == "closed" else "open"
    if not headers:
        return {"ok": False, "error": "github_not_configured", "repo": repo}
    resp = httpx.patch(f"{API}/repos/{repo}/issues/{int(number)}", headers=headers, json={"state": desired}, timeout=20)
    if resp.status_code >= 400:
        return {"ok": False, "error": resp.text[:240], "repo": repo, "status": resp.status_code}
    data = resp.json() if resp.content else {}
    return {"ok": True, "repo": repo, "number": data.get("number"), "html_url": data.get("html_url"), "state": data.get("state")}
