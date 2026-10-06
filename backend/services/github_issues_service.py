"""Create GitHub issues from Studio (feature requests). Server PAT only."""

from __future__ import annotations

from typing import Any

import httpx

from backend.config import settings

API = "https://api.github.com"
UA = {"Accept": "application/vnd.github+json", "User-Agent": "render-studio"}
FEATURE_REQUEST_LABEL = "feature-request"
DEFAULT_REPO = "wprojects/Render-Studio"


def issues_repo() -> str:
    return (settings.github_bugs_repo or "").strip() or DEFAULT_REPO


def _headers() -> dict[str, str] | None:
    token = (settings.github_token or "").strip()
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
