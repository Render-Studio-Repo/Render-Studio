"""
EXAMPLE COPY — Onshape STEP export helpers
SOURCE: backend/services/onshape_oauth.py
PURPOSE: Show Jake's AI how Render Studio creates a doc and uploads STEP.

Flow:
  1. POST /documents  → new Onshape document + default workspace
  2. POST /blobelements/d/{did}/w/{wid}  → multipart STEP upload
  3. Return https://cad.onshape.com/documents/{did}/w/{wid}

Constants (from real module):
  ONSHAPE_API = "https://cad.onshape.com/api/v6"
  Scopes: OAuth2Read OAuth2ReadPII OAuth2Write
"""

from __future__ import annotations

from typing import Any

import httpx

ONSHAPE_API = "https://cad.onshape.com/api/v6"


def _auth_headers(access_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {access_token}"}


def create_onshape_document(access_token: str, name: str, description: str = "") -> dict[str, Any]:
    """Create a new Onshape document. Returns the full document object."""
    resp = httpx.post(
        f"{ONSHAPE_API}/documents",
        headers={**_auth_headers(access_token), "Content-Type": "application/json"},
        json={
            "name": name,
            "description": description,
            "ownerType": 0,  # 0 = personal user workspace
            "isPublic": True,  # free accounts only allow public documents
        },
        timeout=20,
    )
    if not resp.is_success:
        try:
            detail = resp.json()
        except Exception:
            detail = resp.text
        raise httpx.HTTPStatusError(
            f"{resp.status_code}: {detail}",
            request=resp.request,
            response=resp,
        )
    return resp.json()


def upload_step_to_document(
    access_token: str, did: str, wid: str, step_bytes: bytes, filename: str
) -> dict[str, Any]:
    """Upload a STEP file as a blob element into an existing Onshape document/workspace."""
    resp = httpx.post(
        f"{ONSHAPE_API}/blobelements/d/{did}/w/{wid}",
        headers=_auth_headers(access_token),
        files={"file": (filename, step_bytes, "application/octet-stream")},
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()


def export_step_to_onshape(
    access_token: str, step_bytes: bytes, model_name: str
) -> dict[str, Any]:
    """Full flow: create doc → upload STEP → return document URL."""
    doc = create_onshape_document(
        access_token,
        name=model_name,
        description=f"Exported from Render Studio — {model_name}",
    )
    did = doc["id"]
    wid = doc["defaultWorkspace"]["id"]
    step_filename = f"{model_name}.step"
    blob = upload_step_to_document(access_token, did, wid, step_bytes, step_filename)
    eid = blob.get("id", "")
    # Always open the document root so Onshape picks the correct tab
    url = f"https://cad.onshape.com/documents/{did}/w/{wid}"
    return {
        "document_id": did,
        "workspace_id": wid,
        "element_id": eid,
        "url": url,
        "name": model_name,
    }


# OAuth URL pattern (secrets from env — never hardcode):
# ONSHAPE_AUTH_URL = "https://oauth.onshape.com/oauth/authorize"
# params: response_type=code, client_id, redirect_uri, state,
#         scope="OAuth2Read OAuth2ReadPII OAuth2Write"
