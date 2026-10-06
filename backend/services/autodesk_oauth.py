"""Autodesk Platform Services OAuth helpers for Fusion 360 account linking."""

from __future__ import annotations

import secrets
import sqlite3
import time
import urllib.parse
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from backend.config import settings
from backend.database import get_conn

logger = logging.getLogger(__name__)

AUTODESK_AUTH_URL = "https://developer.api.autodesk.com/authentication/v2/authorize"
AUTODESK_TOKEN_URL = "https://developer.api.autodesk.com/authentication/v2/token"
AUTODESK_USERINFO_URL = "https://developer.api.autodesk.com/userprofile/v1/users/@me"
AUTODESK_PROJECT_API = "https://developer.api.autodesk.com/project/v1"
AUTODESK_DATA_API = "https://developer.api.autodesk.com/data/v1"
AUTODESK_OSS_API = "https://developer.api.autodesk.com/oss/v2"
AUTODESK_MFG_GRAPHQL_API = "https://developer.api.autodesk.com/mfg/graphql"
_APS_HOST = "developer.api.autodesk.com"
_APS_PAGE_LIMIT = 200
_APS_MAX_PAGES = 50


def _parse_oauth_timestamp(value: Any) -> datetime | None:
    """Accept Postgres/RFC3339 precision on Python 3.9 as well as newer Python.

    Postgres trims trailing zeroes; Python <3.11 accepts only 3 or 6 fractional
    digits. A malformed expiry must trigger refresh, not crash Fusion exports.
    """
    if isinstance(value, datetime):
        parsed = value
    else:
        text = str(value or "").strip().replace("Z", "+00:00")
        text = re.sub(r"(\d{2}:\d{2}:\d{2})[.,](\d+)",
                      lambda m: m[1] + "." + m[2][:6].ljust(6, "0"), text)
        try:
            parsed = datetime.fromisoformat(text)
        except (TypeError, ValueError):
            return None
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed


def configured_scopes() -> list[str]:
    scopes = [s.strip() for s in (settings.autodesk_scopes or "").split() if s.strip()]
    return scopes or ["data:read", "data:write", "data:create"]


def _ensure_oauth_state_redirect_uri_column(conn) -> None:
    try:
        conn.execute("ALTER TABLE oauth_state ADD COLUMN redirect_uri TEXT")
    except sqlite3.OperationalError:
        pass


def create_oauth_state(user_id: str | None = None, return_url: str | None = None) -> str:
    state = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        _ensure_oauth_state_redirect_uri_column(conn)
        conn.execute(
            "INSERT INTO oauth_state (state, user_id, created_at, redirect_uri) VALUES (?, ?, ?, ?)",
            (state, user_id, now, return_url),
        )
    return state


def consume_oauth_state(state: str) -> dict[str, Any] | bool:
    with get_conn() as conn:
        _ensure_oauth_state_redirect_uri_column(conn)
        row = conn.execute(
            "SELECT user_id, created_at, redirect_uri FROM oauth_state WHERE state = ?",
            (state,),
        ).fetchone()
        if not row:
            return False
        conn.execute("DELETE FROM oauth_state WHERE state = ?", (state,))
    created = _parse_oauth_timestamp(row["created_at"])
    if created is None or datetime.now(timezone.utc) - created > timedelta(minutes=10):
        return False
    return {"user_id": row["user_id"], "return_url": row["redirect_uri"]}


def build_authorization_url(user_id: str | None = None, return_url: str | None = None) -> str:
    if not settings.autodesk_client_id or not settings.autodesk_client_secret:
        raise RuntimeError("Autodesk OAuth is not configured.")
    state = create_oauth_state(user_id, return_url)
    params = {
        "response_type": "code",
        "client_id": settings.autodesk_client_id,
        "redirect_uri": settings.autodesk_redirect_uri,
        "scope": " ".join(configured_scopes()),
        "state": state,
    }
    return f"{AUTODESK_AUTH_URL}?{urllib.parse.urlencode(params, quote_via=urllib.parse.quote)}"


def exchange_code_for_tokens(code: str) -> dict[str, Any]:
    resp = httpx.post(
        AUTODESK_TOKEN_URL,
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": settings.autodesk_redirect_uri,
            "client_id": settings.autodesk_client_id,
            "client_secret": settings.autodesk_client_secret,
        },
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()


def refresh_access_token(refresh_token: str) -> dict[str, Any]:
    resp = httpx.post(
        AUTODESK_TOKEN_URL,
        data={
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": settings.autodesk_client_id,
            "client_secret": settings.autodesk_client_secret,
        },
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()


def get_autodesk_user(access_token: str) -> dict[str, Any]:
    resp = httpx.get(
        AUTODESK_USERINFO_URL,
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()


def upsert_user_tokens(token_data: dict[str, Any], user_id: str) -> dict[str, Any]:
    access_token = token_data["access_token"]
    refresh_token = token_data.get("refresh_token", "")
    expires_in = int(token_data.get("expires_in", 3600))
    expires_at = (datetime.now(timezone.utc) + timedelta(seconds=expires_in)).isoformat()
    try:
        profile = get_autodesk_user(access_token)
    except Exception:
        profile = {}
    autodesk_user_id = str(profile.get("sub") or profile.get("userId") or profile.get("id") or "")
    autodesk_email = (profile.get("email") or profile.get("emailId") or "").strip().lower()
    name_parts = [profile.get("firstName"), profile.get("lastName")]
    autodesk_name = (
        profile.get("name")
        or profile.get("userName")
        or profile.get("preferred_username")
        or " ".join(part for part in name_parts if part).strip()
        or autodesk_email
        or "Autodesk user"
    )
    now = datetime.now(timezone.utc).isoformat()

    with get_conn() as conn:
        conn.execute(
            """INSERT INTO autodesk_tokens
               (user_id, access_token, refresh_token, expires_at, autodesk_user_id, autodesk_email, autodesk_name, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(user_id) DO UPDATE SET
                 access_token = excluded.access_token,
                 refresh_token = excluded.refresh_token,
                 expires_at = excluded.expires_at,
                 autodesk_user_id = excluded.autodesk_user_id,
                 autodesk_email = excluded.autodesk_email,
                 autodesk_name = excluded.autodesk_name,
                 updated_at = excluded.updated_at
            """,
            (user_id, access_token, refresh_token, expires_at, autodesk_user_id, autodesk_email, autodesk_name, now),
        )
    try:
        from backend.services import supabase_workspace_store as ws

        ws.oauth_upsert(
            user_id,
            "autodesk",
            access_token=access_token,
            refresh_token=refresh_token,
            expires_at=expires_at,
            provider_user_id=autodesk_user_id or None,
            provider_email=autodesk_email or None,
            provider_name=autodesk_name or None,
            extra={
                "autodesk_user_id": autodesk_user_id,
                "autodesk_email": autodesk_email,
                "autodesk_name": autodesk_name,
            },
        )
    except Exception:
        logger.debug("autodesk oauth remote upsert skipped", exc_info=True)
    return {
        "user_id": user_id,
        "display_name": autodesk_name,
        "email": autodesk_email,
        "autodesk_user_id": autodesk_user_id,
    }


def get_valid_access_token(user_id: str) -> str | None:
    row = None
    try:
        from backend.services import supabase_workspace_store as ws

        if ws.live():
            packed = ws.oauth_get(user_id, "autodesk")
            if packed:
                row = packed
    except Exception:
        logger.debug("autodesk oauth remote get skipped", exc_info=True)
    if row is None:
        with get_conn() as conn:
            row = conn.execute(
                "SELECT access_token, refresh_token, expires_at FROM autodesk_tokens WHERE user_id = ?",
                (user_id,),
            ).fetchone()
        if row:
            row = dict(row)
    if not row:
        return None
    expires_at = _parse_oauth_timestamp(row.get("expires_at"))
    if expires_at and row.get("access_token") and datetime.now(timezone.utc) < expires_at - timedelta(minutes=5):
        return row["access_token"]
    if not row.get("refresh_token"):
        return None
    try:
        new_tokens = refresh_access_token(row["refresh_token"])
    except Exception:
        return None
    merged = {**new_tokens, "refresh_token": new_tokens.get("refresh_token", row["refresh_token"])}
    upsert_user_tokens(merged, user_id)
    return merged.get("access_token")


def _auth_headers(access_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {access_token}"}


def _aps_error_detail(resp: httpx.Response) -> Any:
    try:
        return resp.json()
    except Exception:
        return resp.text


def _aps_forbidden_hint(*, context: str = "") -> str:
    ctx = f" while {context}" if context else ""
    return (
        f"Autodesk denied access{ctx}. Common fixes: "
        "1) In APS My Apps, enable Data Management API (and Manufacturing Data Model API for Fusion imports). "
        "2) Disconnect and reconnect Autodesk in Render Studio so scopes refresh. "
        "3) Re-link the Fusion mirror folder to a hub/project you still have access to. "
        "4) For ACC/BIM 360 hubs, add this app's Client ID under Account Admin → Custom Integrations."
    )


def _raise_aps(resp: httpx.Response, *, context: str = "") -> None:
    if resp.is_success:
        return
    detail = _aps_error_detail(resp)
    message = f"Autodesk APS {resp.status_code}: {detail}"
    if resp.status_code == 403:
        message = f"{message} {_aps_forbidden_hint(context=context)}"
    raise RuntimeError(message)


def _aps_next_href(payload: dict[str, Any]) -> str | None:
    """Return the JSON:API next-page URL when Autodesk still has more results."""
    href = str(((payload.get("links") or {}).get("next") or {}).get("href") or "").strip()
    if not href:
        return None
    parsed = urllib.parse.urlparse(href)
    if parsed.scheme != "https" or parsed.netloc != _APS_HOST:
        return None
    return href


def _aps_collection_pages(
    access_token: str,
    url: str,
    *,
    params: dict[str, Any] | None = None,
    timeout: float = 20,
    context: str = "",
) -> tuple[list[Any], list[dict[str, Any]]]:
    """GET a JSON:API collection and follow `links.next` until Autodesk is done.

    APS hub/project/folder listings cap a page at 200 (sometimes 100). The Fusion
    library used to keep only page 1, so later projects (e.g. VR Clamps) vanished.
    """
    headers = _auth_headers(access_token)
    data: list[Any] = []
    included: list[dict[str, Any]] = []
    next_url = url
    next_params: dict[str, Any] | None = dict(params or {})
    if "page[limit]" not in next_params:
        next_params["page[limit]"] = _APS_PAGE_LIMIT
    for _ in range(_APS_MAX_PAGES):
        resp = httpx.get(next_url, headers=headers, params=next_params, timeout=timeout)
        _raise_aps(resp, context=context) if context else _raise_aps(resp)
        payload = resp.json() if resp.content else {}
        if not isinstance(payload, dict):
            payload = {}
        data.extend(payload.get("data") or [])
        included.extend(item for item in (payload.get("included") or []) if isinstance(item, dict) and item.get("id"))
        href = _aps_next_href(payload)
        if not href:
            break
        next_url = href
        next_params = None
    return data, included


def fusion_mirror_access_issue(token: str, mirror: dict[str, Any]) -> str | None:
    """Return a user-facing error when a saved Fusion mirror no longer matches APS access."""
    hub_id = str(mirror.get("hub_id") or "").strip()
    aps_project_id = str(mirror.get("aps_project_id") or "").strip()
    folder_id = str(mirror.get("folder_id") or "").strip()
    if not hub_id or not aps_project_id or not folder_id:
        return "Fusion mirror is incomplete. Re-link a hub, project, and folder in Fusion Library."

    try:
        hubs = list_hubs(token)
    except RuntimeError as exc:
        return str(exc)

    hub_ids = {str(h.get("id") or "") for h in hubs}
    if hub_id not in hub_ids:
        label = str(mirror.get("hub_label") or hub_id)
        return (
            f'Your linked Fusion hub "{label}" is no longer accessible with this Autodesk account. '
            "Open Fusion Library → Unlink mirror, then link the folder again on a hub you can still open."
        )

    try:
        projects = list_projects(token, hub_id)
    except RuntimeError as exc:
        return str(exc)

    project_ids = {str(p.get("id") or "") for p in projects}
    if aps_project_id not in project_ids:
        label = str(mirror.get("aps_project_label") or aps_project_id)
        return (
            f'Your linked Fusion project "{label}" is no longer available in hub '
            f'"{mirror.get("hub_label") or hub_id}". Re-link the mirror folder in Fusion Library.'
        )

    try:
        list_folder_contents(token, aps_project_id, folder_id)
    except RuntimeError as exc:
        label = str(mirror.get("folder_label") or folder_id)
        return (
            f'Cannot read Fusion folder "{label}" ({exc}). '
            "You may have lost folder access — re-link the mirror in Fusion Library."
        )
    return None


def list_hubs(access_token: str) -> list[dict[str, Any]]:
    rows, _ = _aps_collection_pages(access_token, f"{AUTODESK_PROJECT_API}/hubs")
    hubs = []
    for hub in rows:
        attrs = hub.get("attributes") or {}
        hubs.append({
            "id": hub.get("id"),
            "name": attrs.get("name") or attrs.get("extension", {}).get("data", {}).get("hubType") or hub.get("id"),
            "type": hub.get("type"),
        })
    return hubs


def list_projects(access_token: str, hub_id: str) -> list[dict[str, Any]]:
    rows, _ = _aps_collection_pages(
        access_token,
        f"{AUTODESK_PROJECT_API}/hubs/{urllib.parse.quote(hub_id, safe='')}/projects",
    )
    projects = []
    for project in rows:
        attrs = project.get("attributes") or {}
        projects.append({
            "id": project.get("id"),
            "name": attrs.get("name") or project.get("id"),
            "type": project.get("type"),
            "last_modified": attrs.get("lastModifiedTime") or attrs.get("updatedTime") or attrs.get("createTime"),
            "created": attrs.get("createTime") or attrs.get("createdTime"),
        })
    projects.sort(
        key=lambda item: str(item.get("last_modified") or item.get("created") or ""),
        reverse=True,
    )
    return projects


def list_top_folders(access_token: str, hub_id: str, project_id: str) -> list[dict[str, Any]]:
    rows, _ = _aps_collection_pages(
        access_token,
        f"{AUTODESK_PROJECT_API}/hubs/{urllib.parse.quote(hub_id, safe='')}/projects/{urllib.parse.quote(project_id, safe='')}/topFolders",
    )
    folders = [_normalize_folder(folder, project_id) for folder in rows]
    folders.sort(
        key=lambda item: str(item.get("last_modified") or item.get("created") or item.get("name") or ""),
        reverse=True,
    )
    return folders


def list_folder_contents(access_token: str, project_id: str, folder_id: str) -> dict[str, Any]:
    rows, included = _aps_collection_pages(
        access_token,
        f"{AUTODESK_DATA_API}/projects/{urllib.parse.quote(project_id, safe='')}/folders/{urllib.parse.quote(folder_id, safe='')}/contents",
        params={"includeHidden": "false"},
        context="reading Fusion folder contents",
    )
    included_by_id = {item.get("id"): item for item in included if item.get("id")}
    folders: list[dict[str, Any]] = []
    items: list[dict[str, Any]] = []
    for entry in rows:
        if entry.get("type") == "folders":
            folders.append(_normalize_folder(entry, project_id))
        elif entry.get("type") == "items":
            items.append(_normalize_item(entry, included_by_id))
    folders.sort(
        key=lambda item: str(item.get("last_modified") or item.get("created") or item.get("name") or ""),
        reverse=True,
    )
    return {"folders": folders, "items": items}


def get_folder_item(access_token: str, project_id: str, folder_id: str, item_id: str) -> dict[str, Any]:
    contents = list_folder_contents(access_token, project_id, folder_id)
    for item in contents.get("items", []) or []:
        if item.get("id") == item_id:
            return item
    raise RuntimeError("Autodesk item not found in the selected folder.")


def _folder_extension_type(folder: dict[str, Any] | None) -> str:
    attrs = (folder or {}).get("attributes") or {}
    ext = attrs.get("extension") or {}
    ext_type = str(ext.get("type") or "").strip()
    if ext_type.startswith("folders:"):
        return ext_type
    return "folders:autodesk.core:Folder"


def get_folder(access_token: str, project_id: str, folder_id: str) -> dict[str, Any]:
    resp = httpx.get(
        f"{AUTODESK_DATA_API}/projects/{urllib.parse.quote(project_id, safe='')}/folders/{urllib.parse.quote(folder_id, safe='')}",
        headers=_auth_headers(access_token),
        timeout=20,
    )
    _raise_aps(resp, context="reading Fusion folder")
    return resp.json().get("data") or {}


def create_folder(access_token: str, project_id: str, parent_folder_id: str, name: str) -> dict[str, Any]:
    """Create a Fusion/APS folder via Data Management POST /projects/{id}/folders."""
    label = str(name or "").strip()
    if not label:
        raise RuntimeError("Folder name is required.")
    parent_id = str(parent_folder_id or "").strip()
    if not parent_id:
        raise RuntimeError("A parent Fusion folder is required.")

    parent = get_folder(access_token, project_id, parent_id)
    extension_types = []
    parent_ext = _folder_extension_type(parent)
    if parent_ext:
        extension_types.append(parent_ext)
    for candidate in ("folders:autodesk.core:Folder", "folders:autodesk.bim360:Folder"):
        if candidate not in extension_types:
            extension_types.append(candidate)

    url = f"{AUTODESK_DATA_API}/projects/{urllib.parse.quote(project_id, safe='')}/folders"
    headers = {**_auth_headers(access_token), "Content-Type": "application/vnd.api+json"}
    last_resp: httpx.Response | None = None
    for ext_type in extension_types:
        resp = httpx.post(
            url,
            headers=headers,
            json={
                "jsonapi": {"version": "1.0"},
                "data": {
                    "type": "folders",
                    "attributes": {
                        "name": label,
                        "extension": {"type": ext_type, "version": "1.0"},
                    },
                    "relationships": {
                        "parent": {"data": {"type": "folders", "id": parent_id}},
                    },
                },
            },
            timeout=30,
        )
        last_resp = resp
        if resp.is_success:
            data = resp.json().get("data") or {}
            return _normalize_folder(data, project_id)
        if resp.status_code != 400:
            break
    if last_resp is None:
        raise RuntimeError("Could not create Fusion folder.")
    _raise_aps(last_resp, context="creating Fusion folder")


def delete_item(access_token: str, project_id: str, item_id: str) -> dict[str, Any]:
    resp = httpx.delete(
        f"{AUTODESK_DATA_API}/projects/{urllib.parse.quote(project_id, safe='')}/items/{urllib.parse.quote(item_id, safe='')}",
        headers=_auth_headers(access_token),
        timeout=30,
    )
    if resp.status_code == 404:
        return {"deleted": False, "missing": True, "item_id": item_id}
    _raise_aps(resp)
    return {"deleted": True, "item_id": item_id}


def download_item_file(access_token: str, item: dict[str, Any]) -> bytes:
    url = item.get("download_url")
    if not url:
        raise RuntimeError("Autodesk did not provide a downloadable file URL for this item.")
    resp = httpx.get(url, headers=_auth_headers(access_token), follow_redirects=True, timeout=120)
    if resp.status_code == 403 and "Legacy endpoint is deprecated" in resp.text:
        parsed = urllib.parse.urlparse(url)
        parts = parsed.path.split("/")
        try:
            bucket_key = parts[4]
            object_name = "/".join(parts[6:])
        except Exception as exc:
            raise RuntimeError(f"Unexpected Autodesk download URL: {url}") from exc
        signed = httpx.get(
            f"{AUTODESK_OSS_API}/buckets/{urllib.parse.quote(bucket_key, safe='')}/objects/{urllib.parse.quote(object_name, safe='')}/signeds3download",
            headers=_auth_headers(access_token),
            params={"minutesExpiration": 10},
            timeout=30,
        )
        _raise_aps(signed)
        signed_url = (signed.json() or {}).get("url")
        if not signed_url:
            raise RuntimeError("Autodesk did not return a signed S3 download URL.")
        resp = httpx.get(signed_url, follow_redirects=True, timeout=120)
    if resp.status_code in {401, 403}:
        resp = httpx.get(url, follow_redirects=True, timeout=120)
    if resp.status_code in {401, 403}:
        encoded_url = urllib.parse.quote(url, safe="")
        resp = httpx.get(
            f"{AUTODESK_OSS_API}/signedresources/{encoded_url}",
            headers=_auth_headers(access_token),
            follow_redirects=True,
            timeout=120,
        )
    _raise_aps(resp)
    return resp.content


def export_fusion_item_as_step(
    access_token: str,
    *,
    hub_id: str,
    project_id: str,
    item_id: str,
    timeout_seconds: int = 180,
) -> bytes:
    mfg_hub_id, mfg_project_id = _mfg_ids_for_data_management_ids(
        access_token,
        hub_id=hub_id,
        project_id=project_id,
    )
    component_version_id = _fusion_root_component_version_id(
        access_token,
        hub_id=mfg_hub_id,
        project_id=mfg_project_id,
        item_id=item_id,
    )
    deadline = time.monotonic() + timeout_seconds
    last_status = ""
    while True:
        derivative = _request_step_derivative(access_token, component_version_id)
        last_status = str(derivative.get("status") or "").upper()
        signed_url = derivative.get("signedUrl")
        if last_status == "SUCCESS" and signed_url:
            resp = httpx.get(signed_url, follow_redirects=True, timeout=120)
            resp.raise_for_status()
            return resp.content
        if last_status in {"FAILED", "TIMEOUT"}:
            raise RuntimeError(f"Autodesk STEP conversion failed with status {last_status}.")
        if time.monotonic() >= deadline:
            raise RuntimeError(f"Autodesk STEP conversion is still {last_status or 'pending'}; try again in a minute.")
        time.sleep(3)


def _mfg_graphql(access_token: str, query: str, variables: dict[str, Any]) -> dict[str, Any]:
    resp = httpx.post(
        AUTODESK_MFG_GRAPHQL_API,
        headers={**_auth_headers(access_token), "Content-Type": "application/json"},
        json={"query": query, "variables": variables},
        timeout=30,
    )
    _raise_aps(resp)
    payload = resp.json()
    if payload.get("errors"):
        raise RuntimeError(payload["errors"])
    return payload.get("data") or {}


def _mfg_ids_for_data_management_ids(access_token: str, *, hub_id: str, project_id: str) -> tuple[str, str]:
    if hub_id.startswith("urn:adsk.ace:") and project_id.startswith("urn:adsk.workspace:"):
        return hub_id, project_id
    hub_query = """
    query HubByDataManagementId($hubId: ID!) {
      hubByDataManagementAPIId(dataManagementAPIHubId: $hubId) {
        id
        name
      }
    }
    """
    hub_data = _mfg_graphql(access_token, hub_query, {"hubId": hub_id})
    mfg_hub_id = ((hub_data.get("hubByDataManagementAPIId") or {}).get("id") or "").strip()
    if not mfg_hub_id:
        raise RuntimeError("Could not map Autodesk hub to Manufacturing Data Model hub.")

    projects_query = """
    query ProjectsForHub($hubId: ID!) {
      projects(hubId: $hubId) {
        results {
          id
          name
          alternativeIdentifiers {
            dataManagementAPIProjectId
          }
        }
      }
    }
    """
    projects_data = _mfg_graphql(access_token, projects_query, {"hubId": mfg_hub_id})
    for project in ((projects_data.get("projects") or {}).get("results") or []):
        alt = project.get("alternativeIdentifiers") or {}
        if alt.get("dataManagementAPIProjectId") == project_id:
            return mfg_hub_id, project.get("id")
    raise RuntimeError("Could not map Autodesk project to Manufacturing Data Model project.")


def _fusion_root_component_version_id(access_token: str, *, hub_id: str, project_id: str, item_id: str) -> str:
    query = """
    query GetFusionDesignRoot($hubId: ID!, $itemId: ID!) {
      item(hubId: $hubId, itemId: $itemId) {
        __typename
        id
        name
        ... on DesignItem {
          tipRootComponentVersion {
            id
            name
          }
        }
      }
    }
    """
    data = _mfg_graphql(access_token, query, {"hubId": hub_id, "itemId": item_id})
    item = data.get("item") or {}
    component = item.get("tipRootComponentVersion") or {}
    component_version_id = component.get("id")
    if not component_version_id:
        typename = item.get("__typename") or "unknown item"
        raise RuntimeError(f"Autodesk item is {typename}; only Fusion DesignItem rows can be auto-converted to STEP.")
    return component_version_id


def _request_step_derivative(access_token: str, component_version_id: str) -> dict[str, Any]:
    query = """
    query GetStepDerivative($componentVersionId: ID!, $derivativeInput: DerivativeInput!) {
      componentVersion(componentVersionId: $componentVersionId) {
        id
        name
        derivatives(derivativeInput: $derivativeInput) {
          expires
          id
          outputFormat
          signedUrl
          status
        }
      }
    }
    """
    data = _mfg_graphql(
        access_token,
        query,
        {
            "componentVersionId": component_version_id,
            "derivativeInput": {"generate": True, "outputFormat": ["STEP"]},
        },
    )
    derivatives = ((data.get("componentVersion") or {}).get("derivatives") or [])
    for derivative in derivatives:
        if str(derivative.get("outputFormat") or "").upper() == "STEP":
            return derivative
    raise RuntimeError("Autodesk did not return a STEP derivative for this Fusion design.")


def upload_step_to_folder(
    access_token: str,
    *,
    project_id: str,
    folder_id: str,
    filename: str,
    data: bytes,
    conflict_mode: str = "replace",
) -> dict[str, Any]:
    """Upload a file into a Fusion/APS folder.

    conflict_mode:
      - replace: if same name exists, create a new version on that item
      - new: if same name exists, upload under a unique name (Create new file)
    """
    mode = str(conflict_mode or "replace").strip().lower()
    if mode not in {"replace", "new"}:
        mode = "replace"

    existing_item_id = ""
    folder_items: list[dict[str, Any]] = []
    try:
        folder_contents = list_folder_contents(access_token, project_id, folder_id)
        folder_items = list(folder_contents.get("items", []) or [])
        for item in folder_items:
            if str(item.get("name") or "").casefold() == filename.casefold():
                existing_item_id = str(item.get("id") or "")
                break
    except Exception as exc:
        logger.debug("Could not preflight Autodesk folder for duplicate %s: %s", filename, exc)

    if existing_item_id and mode == "new":
        filename = _unique_folder_filename(folder_items, filename)
        existing_item_id = ""

    storage = _create_storage(access_token, project_id=project_id, folder_id=folder_id, filename=filename)
    storage_id = storage["data"]["id"]
    bucket_key, object_name = _storage_id_parts(storage_id)
    _upload_object_to_signed_s3(access_token, bucket_key=bucket_key, object_name=object_name, data=data)
    if existing_item_id:
        version = _create_version(access_token, project_id=project_id, item_id=existing_item_id, storage_id=storage_id, filename=filename)
        version_data = version.get("data") or {}
        version_id = version_data.get("id")
        _kickoff_model_thumbnail(access_token, version_id)
        return {
            "item_id": existing_item_id,
            "version_id": version_id,
            "name": filename,
            "storage_id": storage_id,
            "web_url": ((version_data.get("links") or {}).get("webView") or {}).get("href"),
            "updated_existing": True,
            "conflict_mode": "replace",
        }
    item = _create_item(access_token, project_id=project_id, folder_id=folder_id, storage_id=storage_id, filename=filename)
    item_data = item.get("data") or {}
    item_id = item_data.get("id")
    version_id = _version_id_from_create_item(item)
    if not version_id and item_id:
        try:
            for folder_item in list_folder_contents(access_token, project_id, folder_id).get("items", []) or []:
                if folder_item.get("id") == item_id:
                    version_id = folder_item.get("version_id")
                    break
        except Exception as exc:
            logger.debug("Could not read new Autodesk item version for %s: %s", item_id, exc)
    _kickoff_model_thumbnail(access_token, version_id)
    return {
        "item_id": item_id,
        "version_id": version_id,
        "name": filename,
        "storage_id": storage_id,
        "web_url": ((item_data.get("links") or {}).get("webView") or {}).get("href"),
        "conflict_mode": mode,
        "created_new": True,
    }


def _unique_folder_filename(folder_items: list[dict[str, Any]], filename: str) -> str:
    """Return filename, or stem (2).ext / stem (3).ext if taken."""
    from pathlib import Path as _Path

    taken = {str(item.get("name") or "").casefold() for item in folder_items}
    if filename.casefold() not in taken:
        return filename
    stem = _Path(filename).stem
    suffix = _Path(filename).suffix or ".step"
    for n in range(2, 200):
        candidate = f"{stem} ({n}){suffix}"
        if candidate.casefold() not in taken:
            return candidate
    return f"{stem}-{int(time.time())}{suffix}"


def _version_id_from_create_item(payload: dict[str, Any] | None) -> str | None:
    """Pull tip version URN from a Data Management create-item response."""
    if not isinstance(payload, dict):
        return None
    for inc in payload.get("included") or []:
        if not isinstance(inc, dict):
            continue
        if str(inc.get("type") or "") == "versions" and inc.get("id"):
            return str(inc.get("id"))
    tip = (((payload.get("data") or {}).get("relationships") or {}).get("tip") or {}).get("data") or {}
    tip_id = tip.get("id")
    return str(tip_id) if tip_id and str(tip_id) != "1" else None


def _kickoff_model_thumbnail(access_token: str, version_id: str | None) -> None:
    """Best-effort Model Derivative job so Fusion Data Panel gets a real preview thumb.

    Logs showed every prior kickoff returning 406 — usually ``svf2`` unsupported for
    WIP STEP uploads. Prefer classic ``svf`` (+ thumbnail), then fall back.
    """
    if not version_id:
        logger.warning("Fusion thumbnail skipped — missing version_id")
        return
    try:
        import base64

        urn = base64.urlsafe_b64encode(str(version_id).encode("utf-8")).decode("ascii").rstrip("=")
        attempts: list[dict[str, Any]] = [
            # SVF first — STEP on Fusion hubs often rejects SVF2 with 406.
            {
                "formats": [
                    {"type": "svf", "views": ["3d"]},
                    {"type": "thumbnail", "advanced": {"width": 400, "height": 400}},
                ]
            },
            {"formats": [{"type": "svf", "views": ["3d"]}]},
            {"formats": [{"type": "thumbnail", "advanced": {"width": 400, "height": 400}}]},
            {
                "formats": [
                    {"type": "svf2", "views": ["3d"]},
                    {"type": "thumbnail", "advanced": {"width": 400, "height": 400}},
                ]
            },
        ]
        last_detail = ""
        for idx, output in enumerate(attempts):
            resp = httpx.post(
                "https://developer.api.autodesk.com/modelderivative/v2/designdata/job",
                headers={
                    **_auth_headers(access_token),
                    "Content-Type": "application/json",
                    "x-ads-force": "true",
                },
                json={"input": {"urn": urn}, "output": output},
                timeout=30,
            )
            if resp.status_code in {200, 201, 202}:
                logger.info(
                    "Fusion thumbnail job started version=%s attempt=%s formats=%s",
                    version_id,
                    idx,
                    [f.get("type") for f in output.get("formats") or []],
                )
                return
            last_detail = (resp.text or "")[:300]
            # 406/400 = unsupported format combo — try next payload.
            if resp.status_code not in {400, 406, 409}:
                logger.warning(
                    "Fusion thumbnail job failed version=%s status=%s body=%s",
                    version_id,
                    resp.status_code,
                    last_detail,
                )
                return
        logger.warning(
            "Fusion thumbnail job not accepted version=%s last=%s",
            version_id,
            last_detail,
        )
    except Exception as exc:
        logger.warning("Fusion thumbnail kickoff failed for %s: %s", version_id, exc)


def upload_step_as_new_version(
    access_token: str,
    *,
    project_id: str,
    folder_id: str,
    item_id: str,
    filename: str,
    data: bytes,
) -> dict[str, Any]:
    storage = _create_storage(access_token, project_id=project_id, folder_id=folder_id, filename=filename)
    storage_id = storage["data"]["id"]
    bucket_key, object_name = _storage_id_parts(storage_id)
    _upload_object_to_signed_s3(access_token, bucket_key=bucket_key, object_name=object_name, data=data)
    version = _create_version(access_token, project_id=project_id, item_id=item_id, storage_id=storage_id, filename=filename)
    version_data = version.get("data") or {}
    version_id = version_data.get("id")
    _kickoff_model_thumbnail(access_token, version_id)
    return {
        "item_id": item_id,
        "version_id": version_id,
        "name": filename,
        "storage_id": storage_id,
        "web_url": ((version_data.get("links") or {}).get("webView") or {}).get("href"),
        "updated_existing": True,
    }


def _upload_object_to_signed_s3(access_token: str, *, bucket_key: str, object_name: str, data: bytes) -> dict[str, Any]:
    encoded_bucket = urllib.parse.quote(bucket_key, safe="")
    encoded_object = urllib.parse.quote(object_name, safe="")
    signed = httpx.get(
        f"{AUTODESK_OSS_API}/buckets/{encoded_bucket}/objects/{encoded_object}/signeds3upload",
        headers=_auth_headers(access_token),
        params={"minutesExpiration": 10, "useAcceleration": "true"},
        timeout=30,
    )
    _raise_aps(signed)
    payload = signed.json()
    urls = payload.get("urls") or []
    upload_key = payload.get("uploadKey")
    if not urls or not upload_key:
        raise RuntimeError("Autodesk did not return a signed S3 upload URL.")

    put = httpx.put(
        urls[0],
        content=data,
        headers={"Content-Type": "application/octet-stream"},
        timeout=180,
    )
    put.raise_for_status()

    complete = httpx.post(
        f"{AUTODESK_OSS_API}/buckets/{encoded_bucket}/objects/{encoded_object}/signeds3upload",
        headers={**_auth_headers(access_token), "Content-Type": "application/json"},
        json={"uploadKey": upload_key},
        timeout=60,
    )
    _raise_aps(complete)
    return complete.json()


def _create_storage(access_token: str, *, project_id: str, folder_id: str, filename: str) -> dict[str, Any]:
    resp = httpx.post(
        f"{AUTODESK_DATA_API}/projects/{urllib.parse.quote(project_id, safe='')}/storage",
        headers={**_auth_headers(access_token), "Content-Type": "application/vnd.api+json"},
        json={
            "jsonapi": {"version": "1.0"},
            "data": {
                "type": "objects",
                "attributes": {"name": filename},
                "relationships": {"target": {"data": {"type": "folders", "id": folder_id}}},
            },
        },
        timeout=30,
    )
    _raise_aps(resp)
    return resp.json()


def _create_version(access_token: str, *, project_id: str, item_id: str, storage_id: str, filename: str) -> dict[str, Any]:
    resp = httpx.post(
        f"{AUTODESK_DATA_API}/projects/{urllib.parse.quote(project_id, safe='')}/versions",
        headers={**_auth_headers(access_token), "Content-Type": "application/vnd.api+json"},
        json={
            "jsonapi": {"version": "1.0"},
            "data": {
                "type": "versions",
                "attributes": {
                    "name": filename,
                    "extension": {"type": "versions:autodesk.core:File", "version": "1.0"},
                },
                "relationships": {
                    "item": {"data": {"type": "items", "id": item_id}},
                    "storage": {"data": {"type": "objects", "id": storage_id}},
                },
            },
        },
        timeout=30,
    )
    _raise_aps(resp)
    return resp.json()


def _create_item(access_token: str, *, project_id: str, folder_id: str, storage_id: str, filename: str) -> dict[str, Any]:
    resp = httpx.post(
        f"{AUTODESK_DATA_API}/projects/{urllib.parse.quote(project_id, safe='')}/items",
        headers={**_auth_headers(access_token), "Content-Type": "application/vnd.api+json"},
        json={
            "jsonapi": {"version": "1.0"},
            "data": {
                "type": "items",
                "attributes": {
                    "displayName": filename,
                    "extension": {"type": "items:autodesk.core:File", "version": "1.0"},
                },
                "relationships": {
                    "tip": {"data": {"type": "versions", "id": "1"}},
                    "parent": {"data": {"type": "folders", "id": folder_id}},
                },
            },
            "included": [
                {
                    "type": "versions",
                    "id": "1",
                    "attributes": {
                        "name": filename,
                        "extension": {"type": "versions:autodesk.core:File", "version": "1.0"},
                    },
                    "relationships": {"storage": {"data": {"type": "objects", "id": storage_id}}},
                }
            ],
        },
        timeout=30,
    )
    _raise_aps(resp)
    return resp.json()


def _storage_id_parts(storage_id: str) -> tuple[str, str]:
    marker = "urn:adsk.objects:os.object:"
    object_path = storage_id[len(marker):] if storage_id.startswith(marker) else storage_id.rsplit(":", 1)[-1]
    if "/" not in object_path:
        raise RuntimeError(f"Unexpected Autodesk storage id: {storage_id}")
    bucket_key, object_name = object_path.split("/", 1)
    return bucket_key, object_name


def _normalize_folder(folder: dict[str, Any], project_id: str) -> dict[str, Any]:
    attrs = folder.get("attributes") or {}
    return {
        "id": folder.get("id"),
        "project_id": project_id,
        "name": attrs.get("displayName") or attrs.get("name") or folder.get("id"),
        "type": "folder",
        "last_modified": attrs.get("lastModifiedTime") or attrs.get("createTime"),
        "created": attrs.get("createTime"),
        "object_count": attrs.get("objectCount"),
    }


def _normalize_item(item: dict[str, Any], included_by_id: dict[str, dict[str, Any]]) -> dict[str, Any]:
    attrs = item.get("attributes") or {}
    tip_id = (((item.get("relationships") or {}).get("tip") or {}).get("data") or {}).get("id")
    version = included_by_id.get(tip_id or "") or {}
    version_attrs = version.get("attributes") or {}
    storage_meta = (((version.get("relationships") or {}).get("storage") or {}).get("meta") or {})
    thumb_link = _extract_thumbnail_href(version) or _extract_thumbnail_href(item)
    version_id = version.get("id") or tip_id
    return {
        "id": item.get("id"),
        "version_id": version_id,
        "name": attrs.get("displayName") or version_attrs.get("name") or item.get("id"),
        "type": "item",
        "mime_type": version_attrs.get("mimeType") or attrs.get("mimeType"),
        "download_url": ((storage_meta.get("link") or {}).get("href")),
        "web_url": ((item.get("links") or {}).get("webView") or {}).get("href"),
        "thumbnail_url": thumb_link or None,
        # Browser loads this via Bearer auth (fetch → blob URL).
        "thumbnail_proxy": (
            f"/api/autodesk/thumbnail?version_id={urllib.parse.quote(str(version_id), safe='')}"
            if version_id
            else None
        ),
    }


def _extract_thumbnail_href(node: dict[str, Any] | None) -> str | None:
    if not isinstance(node, dict):
        return None
    thumb_rel = ((node.get("relationships") or {}).get("thumbnails") or {})
    if not isinstance(thumb_rel, dict):
        return None
    meta_link = (((thumb_rel.get("meta") or {}).get("link") or {}).get("href"))
    if isinstance(meta_link, str) and meta_link.startswith("http"):
        return meta_link
    data = thumb_rel.get("data")
    if isinstance(data, dict):
        href = data.get("href") or data.get("id")
        if isinstance(href, str) and href.startswith("http"):
            return href
    if isinstance(data, list):
        for entry in data:
            if not isinstance(entry, dict):
                continue
            href = entry.get("href") or (((entry.get("meta") or {}).get("link") or {}).get("href"))
            if isinstance(href, str) and href.startswith("http"):
                return href
    return None


def fetch_version_thumbnail(
    access_token: str,
    version_id: str,
    *,
    width: int = 200,
    height: int = 200,
    fallback_url: str | None = None,
) -> tuple[bytes, str] | None:
    """Return (bytes, content_type) for a Fusion/APS version thumbnail, or None."""
    import base64

    vid = str(version_id or "").strip()
    if not vid and not fallback_url:
        return None

    w = max(50, min(400, int(width or 200)))
    h = max(50, min(400, int(height or 200)))
    headers = _auth_headers(access_token)

    if vid:
        urn = base64.urlsafe_b64encode(vid.encode("utf-8")).decode("ascii").rstrip("=")
        try:
            resp = httpx.get(
                f"https://developer.api.autodesk.com/modelderivative/v2/designdata/{urn}/thumbnail",
                headers=headers,
                params={"width": w, "height": h},
                timeout=25,
                follow_redirects=True,
            )
            if resp.status_code == 202:
                # Thumbnail still translating — nudge a job and fall through to APS link.
                _kickoff_model_thumbnail(access_token, vid)
            elif resp.status_code == 200 and resp.content:
                ctype = (resp.headers.get("content-type") or "image/png").split(";")[0].strip() or "image/png"
                return resp.content, ctype
        except Exception as exc:
            logger.debug("Model Derivative thumbnail failed for %s: %s", vid, exc)

    if fallback_url and str(fallback_url).startswith("http"):
        try:
            resp = httpx.get(fallback_url, headers=headers, timeout=25, follow_redirects=True)
            if resp.status_code in {401, 403}:
                resp = httpx.get(fallback_url, timeout=25, follow_redirects=True)
            if resp.status_code == 200 and resp.content:
                ctype = (resp.headers.get("content-type") or "image/png").split(";")[0].strip() or "image/png"
                if ctype.startswith("image/") or ctype in {"application/octet-stream"}:
                    return resp.content, ctype if ctype.startswith("image/") else "image/png"
        except Exception as exc:
            logger.debug("Fallback thumbnail fetch failed: %s", exc)
    return None
