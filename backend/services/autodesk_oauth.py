"""Autodesk Platform Services OAuth helpers for Fusion 360 account linking."""

from __future__ import annotations

import secrets
import sqlite3
import time
import urllib.parse
import logging
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
    created = datetime.fromisoformat(row["created_at"])
    if datetime.now(timezone.utc) - created > timedelta(minutes=10):
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
    return {
        "user_id": user_id,
        "display_name": autodesk_name,
        "email": autodesk_email,
        "autodesk_user_id": autodesk_user_id,
    }


def get_valid_access_token(user_id: str) -> str | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT access_token, refresh_token, expires_at FROM autodesk_tokens WHERE user_id = ?",
            (user_id,),
        ).fetchone()
    if not row:
        return None
    expires_at = datetime.fromisoformat(row["expires_at"])
    if datetime.now(timezone.utc) < expires_at - timedelta(minutes=5):
        return row["access_token"]
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
        "2) Disconnect and reconnect Autodesk in Render3D so scopes refresh. "
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
    resp = httpx.get(f"{AUTODESK_PROJECT_API}/hubs", headers=_auth_headers(access_token), timeout=20)
    _raise_aps(resp)
    hubs = []
    for hub in resp.json().get("data", []) or []:
        attrs = hub.get("attributes") or {}
        hubs.append({
            "id": hub.get("id"),
            "name": attrs.get("name") or attrs.get("extension", {}).get("data", {}).get("hubType") or hub.get("id"),
            "type": hub.get("type"),
        })
    return hubs


def list_projects(access_token: str, hub_id: str) -> list[dict[str, Any]]:
    resp = httpx.get(
        f"{AUTODESK_PROJECT_API}/hubs/{urllib.parse.quote(hub_id, safe='')}/projects",
        headers=_auth_headers(access_token),
        timeout=20,
    )
    _raise_aps(resp)
    projects = []
    for project in resp.json().get("data", []) or []:
        attrs = project.get("attributes") or {}
        projects.append({
            "id": project.get("id"),
            "name": attrs.get("name") or project.get("id"),
            "type": project.get("type"),
        })
    return projects


def list_top_folders(access_token: str, hub_id: str, project_id: str) -> list[dict[str, Any]]:
    resp = httpx.get(
        f"{AUTODESK_PROJECT_API}/hubs/{urllib.parse.quote(hub_id, safe='')}/projects/{urllib.parse.quote(project_id, safe='')}/topFolders",
        headers=_auth_headers(access_token),
        timeout=20,
    )
    _raise_aps(resp)
    return [_normalize_folder(folder, project_id) for folder in resp.json().get("data", []) or []]


def list_folder_contents(access_token: str, project_id: str, folder_id: str) -> dict[str, Any]:
    resp = httpx.get(
        f"{AUTODESK_DATA_API}/projects/{urllib.parse.quote(project_id, safe='')}/folders/{urllib.parse.quote(folder_id, safe='')}/contents",
        headers=_auth_headers(access_token),
        timeout=20,
    )
    _raise_aps(resp, context="reading Fusion folder contents")
    payload = resp.json()
    included_by_id = {item.get("id"): item for item in payload.get("included", []) or [] if item.get("id")}
    folders: list[dict[str, Any]] = []
    items: list[dict[str, Any]] = []
    for entry in payload.get("data", []) or []:
        if entry.get("type") == "folders":
            folders.append(_normalize_folder(entry, project_id))
        elif entry.get("type") == "items":
            items.append(_normalize_item(entry, included_by_id))
    return {"folders": folders, "items": items}


def get_folder_item(access_token: str, project_id: str, folder_id: str, item_id: str) -> dict[str, Any]:
    contents = list_folder_contents(access_token, project_id, folder_id)
    for item in contents.get("items", []) or []:
        if item.get("id") == item_id:
            return item
    raise RuntimeError("Autodesk item not found in the selected folder.")


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


def upload_step_to_folder(access_token: str, *, project_id: str, folder_id: str, filename: str, data: bytes) -> dict[str, Any]:
    existing_item_id = ""
    try:
        folder_contents = list_folder_contents(access_token, project_id, folder_id)
        for item in folder_contents.get("items", []) or []:
            if str(item.get("name") or "").casefold() == filename.casefold():
                existing_item_id = str(item.get("id") or "")
                break
    except Exception as exc:
        logger.debug("Could not preflight Autodesk folder for duplicate %s: %s", filename, exc)

    storage = _create_storage(access_token, project_id=project_id, folder_id=folder_id, filename=filename)
    storage_id = storage["data"]["id"]
    bucket_key, object_name = _storage_id_parts(storage_id)
    _upload_object_to_signed_s3(access_token, bucket_key=bucket_key, object_name=object_name, data=data)
    if existing_item_id:
        version = _create_version(access_token, project_id=project_id, item_id=existing_item_id, storage_id=storage_id, filename=filename)
        version_data = version.get("data") or {}
        return {
            "item_id": existing_item_id,
            "version_id": version_data.get("id"),
            "name": filename,
            "storage_id": storage_id,
            "web_url": ((version_data.get("links") or {}).get("webView") or {}).get("href"),
            "updated_existing": True,
        }
    item = _create_item(access_token, project_id=project_id, folder_id=folder_id, storage_id=storage_id, filename=filename)
    item_data = item.get("data") or {}
    item_id = item_data.get("id")
    version_id = None
    if item_id:
        try:
            for folder_item in list_folder_contents(access_token, project_id, folder_id).get("items", []) or []:
                if folder_item.get("id") == item_id:
                    version_id = folder_item.get("version_id")
                    break
        except Exception as exc:
            logger.debug("Could not read new Autodesk item version for %s: %s", item_id, exc)
    return {
        "item_id": item_id,
        "version_id": version_id,
        "name": filename,
        "storage_id": storage_id,
        "web_url": ((item_data.get("links") or {}).get("webView") or {}).get("href"),
    }


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
    return {
        "item_id": item_id,
        "version_id": version_data.get("id"),
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
    }


def _normalize_item(item: dict[str, Any], included_by_id: dict[str, dict[str, Any]]) -> dict[str, Any]:
    attrs = item.get("attributes") or {}
    tip_id = (((item.get("relationships") or {}).get("tip") or {}).get("data") or {}).get("id")
    version = included_by_id.get(tip_id or "") or {}
    version_attrs = version.get("attributes") or {}
    storage_meta = (((version.get("relationships") or {}).get("storage") or {}).get("meta") or {})
    return {
        "id": item.get("id"),
        "version_id": version.get("id") or tip_id,
        "name": attrs.get("displayName") or version_attrs.get("name") or item.get("id"),
        "type": "item",
        "mime_type": version_attrs.get("mimeType") or attrs.get("mimeType"),
        "download_url": ((storage_meta.get("link") or {}).get("href")),
        "web_url": ((item.get("links") or {}).get("webView") or {}).get("href"),
    }