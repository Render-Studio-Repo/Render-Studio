"""Onshape OAuth 2.0 helpers.

Flow:
  1. /oauth/start  → build_authorization_url() → redirect user to Onshape
  2. Onshape → /oauth/callback?code=...&state=...
  3. exchange_code_for_tokens() → access_token + refresh_token
  4. get_onshape_user()         → Onshape user profile
  5. upsert_user_tokens()       → store tokens in DB, return our JWT
"""

from __future__ import annotations

import secrets
import urllib.parse
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from backend.config import settings
from backend.database import get_conn

ONSHAPE_AUTH_URL = "https://oauth.onshape.com/oauth/authorize"
ONSHAPE_TOKEN_URL = "https://oauth.onshape.com/oauth/token"
ONSHAPE_USER_URL  = "https://cad.onshape.com/api/v6/users/sessioninfo"

# ---------------------------------------------------------------------------
# State (CSRF) helpers
# ---------------------------------------------------------------------------

def create_oauth_state(user_id: str | None = None) -> str:
    """Generate a random state token and persist it briefly."""
    state = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO oauth_state (state, user_id, created_at) VALUES (?, ?, ?)",
            (state, user_id, now),
        )
    return state


def consume_oauth_state(state: str) -> str | None:
    """Verify and delete the state token. Returns user_id (may be None)."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT user_id, created_at FROM oauth_state WHERE state = ?", (state,)
        ).fetchone()
        if not row:
            return False  # unknown / already used
        conn.execute("DELETE FROM oauth_state WHERE state = ?", (state,))
    # Expire after 10 minutes
    created = datetime.fromisoformat(row["created_at"])
    if datetime.now(timezone.utc) - created > timedelta(minutes=10):
        return False
    return row["user_id"]  # may be None for new-user flow


# ---------------------------------------------------------------------------
# Authorization URL
# ---------------------------------------------------------------------------

def build_authorization_url(user_id: str | None = None) -> str:
    state = create_oauth_state(user_id)
    params = {
        "response_type": "code",
        "client_id":     settings.onshape_client_id,
        "redirect_uri":  settings.onshape_redirect_uri,
        "state":         state,
        "scope":         "OAuth2Read OAuth2ReadPII OAuth2Write",
    }
    return f"{ONSHAPE_AUTH_URL}?{urllib.parse.urlencode(params)}"


# ---------------------------------------------------------------------------
# Token exchange
# ---------------------------------------------------------------------------

def exchange_code_for_tokens(code: str) -> dict[str, Any]:
    resp = httpx.post(
        ONSHAPE_TOKEN_URL,
        data={
            "grant_type":    "authorization_code",
            "code":          code,
            "redirect_uri":  settings.onshape_redirect_uri,
            "client_id":     settings.onshape_client_id,
            "client_secret": settings.onshape_client_secret,
        },
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()


def refresh_access_token(refresh_token: str) -> dict[str, Any]:
    resp = httpx.post(
        ONSHAPE_TOKEN_URL,
        data={
            "grant_type":    "refresh_token",
            "refresh_token": refresh_token,
            "client_id":     settings.onshape_client_id,
            "client_secret": settings.onshape_client_secret,
        },
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()


# ---------------------------------------------------------------------------
# User info from Onshape
# ---------------------------------------------------------------------------

def get_onshape_user(access_token: str) -> dict[str, Any]:
    resp = httpx.get(
        ONSHAPE_USER_URL,
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()


# ---------------------------------------------------------------------------
# Persist tokens & upsert local user
# ---------------------------------------------------------------------------

def upsert_user_tokens(token_data: dict[str, Any], link_user_id: str | None = None) -> dict[str, Any]:
    """Store Onshape tokens and return (or create) the local user record.

    When ``link_user_id`` is set (connect-after-login), tokens are attached to
    that Render Studio account instead of creating a separate Onshape-only user.

    Returns a dict with 'user_id' so the caller can issue our own JWT.
    """
    import uuid
    from datetime import datetime, timezone, timedelta

    access_token  = token_data["access_token"]
    refresh_token = token_data.get("refresh_token", "")
    expires_in    = int(token_data.get("expires_in", 3600))
    expires_at    = (datetime.now(timezone.utc) + timedelta(seconds=expires_in)).isoformat()

    # Fetch Onshape profile
    profile = get_onshape_user(access_token)
    onshape_uid   = profile.get("id") or profile.get("userId", "")
    onshape_email = (profile.get("email") or "").strip().lower()
    display_name  = profile.get("name") or profile.get("firstName", "Onshape User")
    now = datetime.now(timezone.utc).isoformat()
    preferred_user_id = str(link_user_id or "").strip() or None

    with get_conn() as conn:
        # Prefer explicit link (connect flow), then existing Onshape/email match.
        row = None
        if preferred_user_id:
            exists = conn.execute("SELECT id FROM users WHERE id = ?", (preferred_user_id,)).fetchone()
            if exists:
                row = {"user_id": preferred_user_id}
        if not row and onshape_uid:
            row = conn.execute(
                "SELECT user_id FROM onshape_tokens WHERE onshape_user_id = ?",
                (onshape_uid,),
            ).fetchone()
        if not row and onshape_email:
            urow = conn.execute(
                "SELECT id FROM users WHERE email = ?", (onshape_email,)
            ).fetchone()
            if urow:
                row = {"user_id": urow["id"]}

        if row:
            user_id = row["user_id"]
        else:
            # Create a new local user (no password — Onshape-only login)
            user_id = str(uuid.uuid4())
            conn.execute(
                "INSERT INTO users (id, email, display_name, password_hash, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (user_id, onshape_email or f"onshape_{onshape_uid}@onshape.local",
                 display_name, "", now),
            )

        # Upsert tokens
        conn.execute(
            """INSERT INTO onshape_tokens
               (user_id, access_token, refresh_token, expires_at, onshape_user_id, onshape_email, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(user_id) DO UPDATE SET
                 access_token  = excluded.access_token,
                 refresh_token = excluded.refresh_token,
                 expires_at    = excluded.expires_at,
                 onshape_user_id = excluded.onshape_user_id,
                 onshape_email   = excluded.onshape_email,
                 updated_at      = excluded.updated_at
            """,
            (user_id, access_token, refresh_token, expires_at, onshape_uid, onshape_email, now),
        )

    return {"user_id": user_id, "display_name": display_name, "email": onshape_email}


# ---------------------------------------------------------------------------
# Onshape document & file operations
# ---------------------------------------------------------------------------

ONSHAPE_API = "https://cad.onshape.com/api/v6"


def _auth_headers(access_token: str) -> dict:
    return {"Authorization": f"Bearer {access_token}"}


def create_onshape_document(access_token: str, name: str, description: str = "") -> dict[str, Any]:
    """Create a new Onshape document. Returns the full document object."""
    resp = httpx.post(
        f"{ONSHAPE_API}/documents",
        headers={**_auth_headers(access_token), "Content-Type": "application/json"},
        json={
            "name": name,
            "description": description,
            "ownerType": 0,   # 0 = personal user workspace
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


def upload_step_to_document(access_token: str, did: str, wid: str,
                            step_bytes: bytes, filename: str) -> dict[str, Any]:
    """Upload a STEP file as a blob element into an existing Onshape document/workspace."""
    resp = httpx.post(
        f"{ONSHAPE_API}/blobelements/d/{did}/w/{wid}",
        headers=_auth_headers(access_token),
        files={"file": (filename, step_bytes, "application/octet-stream")},
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()


def export_step_to_onshape(access_token: str, step_bytes: bytes,
                           model_name: str) -> dict[str, Any]:
    """Full flow: create doc → upload STEP → return document URL."""
    doc = create_onshape_document(access_token, name=model_name,
                                  description=f"Exported from Render Studio — {model_name}")
    did = doc["id"]
    wid = doc["defaultWorkspace"]["id"]
    step_filename = f"{model_name}.step"
    blob = upload_step_to_document(access_token, did, wid, step_bytes, step_filename)
    eid = blob.get("id", "")
    # Always open the document root so Onshape picks the correct tab
    url = f"https://cad.onshape.com/documents/{did}/w/{wid}"
    return {"document_id": did, "workspace_id": wid, "element_id": eid,
            "url": url, "name": model_name}


# ---------------------------------------------------------------------------
# Import from Onshape
# ---------------------------------------------------------------------------

def list_documents(access_token: str, limit: int = 20, offset: int = 0) -> list[dict]:
    """List the user's recent Onshape documents."""
    resp = httpx.get(
        f"{ONSHAPE_API}/documents",
        headers=_auth_headers(access_token),
        # filter=1 = documents owned by the calling user
        params={"filter": 1, "sortColumn": "modifiedAt", "sortOrder": "desc",
                "limit": min(limit, 20), "offset": offset},
        timeout=15,
    )
    if not resp.is_success:
        try:
            detail = resp.json()
        except Exception:
            detail = resp.text
        raise RuntimeError(f"Onshape {resp.status_code}: {detail}")
    resp.raise_for_status()
    data = resp.json()
    items = data.get("items", [])
    result = []
    for doc in items:
        wid = (doc.get("defaultWorkspace") or {}).get("id", "")
        result.append({
            "id":          doc["id"],
            "name":        doc.get("name", "Untitled"),
            "thumbnail":   doc.get("thumbnail", {}).get("href", ""),
            "modified_at": doc.get("modifiedAt", ""),
            "workspace_id": wid,
            "href":        f"https://cad.onshape.com/documents/{doc['id']}/w/{wid}",
        })
    return result


def list_elements(access_token: str, did: str, wid: str) -> list[dict]:
    """List importable elements inside a document workspace."""
    resp = httpx.get(
        f"{ONSHAPE_API}/documents/d/{did}/w/{wid}/elements",
        headers=_auth_headers(access_token),
        timeout=15,
    )
    if not resp.is_success:
        try:
            detail = resp.json()
        except Exception:
            detail = resp.text
        raise RuntimeError(f"Onshape {resp.status_code}: {detail}")
    elements = resp.json()
    # Onshape returns title-case types: "Part Studio", "Assembly", "Blob", "Application"
    IMPORTABLE = {"Part Studio", "Assembly", "Blob"}
    TYPE_KEY = {
        "Part Studio": "PARTSTUDIO",
        "Assembly":    "ASSEMBLY",
        "Blob":        "BLOB",
    }
    # System/metadata element names to exclude
    import re
    SYSTEM_RE = re.compile(
        r'^(Open CASCADE|Default geometry|Variable Studio|BOM|Bill of Materials|Dashboard)',
        re.IGNORECASE
    )
    STEP_3D_RE = re.compile(r'\.(step|stp|stl|3mf|obj|glb|gltf)$', re.IGNORECASE)

    result = []
    for e in elements:
        etype = e.get("type", "")
        if etype not in IMPORTABLE:
            continue
        name = e.get("name", "Untitled")
        if SYSTEM_RE.match(name):
            continue
        # For blobs, only include recognised 3D formats
        if etype == "Blob" and not STEP_3D_RE.search(name):
            continue
        result.append({
            "id":   e["id"],
            "name": name,
            "type": TYPE_KEY.get(etype, "BLOB"),
        })
    return result


def _raise_for_onshape(resp: httpx.Response) -> None:
    if not resp.is_success:
        try:
            detail = resp.json()
        except Exception:
            detail = resp.text
        raise RuntimeError(f"Onshape {resp.status_code}: {detail}")


def _translate_to_step(access_token: str, resource: str,
                       did: str, wid: str, eid: str) -> bytes:
    """Use Onshape's async translation API to export a Part Studio or Assembly as STEP.
    resource: 'partstudios' or 'assemblies'
    Polls until the job completes, then downloads the result."""
    import time

    # Start translation job
    resp = httpx.post(
        f"{ONSHAPE_API}/{resource}/d/{did}/w/{wid}/e/{eid}/translations",
        headers={**_auth_headers(access_token), "Content-Type": "application/json"},
        json={"formatName": "STEP", "storeInDocument": False},
        timeout=30,
    )
    _raise_for_onshape(resp)
    job = resp.json()
    tid = job.get("id") or job.get("requestId")
    if not tid:
        raise RuntimeError(f"No translation ID in response: {job}")

    # Poll until done (max 90 s)
    for _ in range(45):
        time.sleep(2)
        poll = httpx.get(
            f"{ONSHAPE_API}/translations/{tid}",
            headers=_auth_headers(access_token),
            timeout=15,
        )
        _raise_for_onshape(poll)
        state = poll.json()
        request_state = state.get("requestState", "")
        if request_state == "DONE":
            ext_ids = state.get("resultExternalDataIds") or []
            if not ext_ids:
                raise RuntimeError("Translation finished but no result files.")
            # Download the first result file
            dl = httpx.get(
                f"{ONSHAPE_API}/documents/d/{did}/externaldata/{ext_ids[0]}",
                headers=_auth_headers(access_token),
                follow_redirects=True,
                timeout=60,
            )
            _raise_for_onshape(dl)
            return dl.content
        if request_state == "FAILED":
            raise RuntimeError(f"Translation job failed: {state.get('failureReason', 'unknown')}")

    raise RuntimeError("Translation timed out after 90 seconds.")


def download_element_as_step(access_token: str, did: str, wid: str, eid: str,
                              element_type: str = "PARTSTUDIO") -> bytes:
    """Export an Onshape element as a STEP file (or download a blob directly)."""
    if element_type == "BLOB":
        resp = httpx.get(
            f"{ONSHAPE_API}/blobelements/d/{did}/w/{wid}/e/{eid}",
            headers=_auth_headers(access_token),
            timeout=120,
            follow_redirects=True,
        )
        _raise_for_onshape(resp)
        return resp.content

    if element_type == "ASSEMBLY":
        return _translate_to_step(access_token, "assemblies", did, wid, eid)

    # PARTSTUDIO or APPLICATION
    return _translate_to_step(access_token, "partstudios", did, wid, eid)


def get_document_thumbnail(access_token: str, did: str, wid: str, eid: str) -> bytes | None:
    """Fetch a thumbnail PNG for an element (best-effort)."""
    try:
        resp = httpx.get(
            f"{ONSHAPE_API}/thumbnails/d/{did}/w/{wid}/e/{eid}",
            headers=_auth_headers(access_token),
            params={"sz": "300x170"},
            timeout=10,
            follow_redirects=True,
        )
        if resp.is_success and resp.headers.get("content-type", "").startswith("image"):
            return resp.content
    except Exception:
        pass
    return None


# ---------------------------------------------------------------------------
# Get stored tokens for a user (with auto-refresh)
# ---------------------------------------------------------------------------

def get_valid_access_token(user_id: str) -> str | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT access_token, refresh_token, expires_at FROM onshape_tokens WHERE user_id = ?",
            (user_id,),
        ).fetchone()
    if not row:
        return None
    expires_at = datetime.fromisoformat(row["expires_at"])
    if datetime.now(timezone.utc) < expires_at - timedelta(minutes=5):
        return row["access_token"]
    # Token expired — refresh it, keeping tokens on the same Render Studio user.
    try:
        new_tokens = refresh_access_token(row["refresh_token"])
        upsert_user_tokens(
            {
                **new_tokens,
                "refresh_token": new_tokens.get("refresh_token", row["refresh_token"]),
            },
            link_user_id=user_id,
        )
        return new_tokens["access_token"]
    except Exception:
        return None
