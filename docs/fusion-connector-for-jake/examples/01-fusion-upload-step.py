"""
EXAMPLE COPY — Fusion / APS STEP upload helpers
SOURCE: backend/services/autodesk_oauth.py
PURPOSE: Show Jake's AI the exact upload pipeline used by Render Studio.

Flow:
  1. create storage object in target folder
  2. signed S3 PUT of file bytes
  3. create item (new) OR create version (replace same name)

Constants (from real module):
  AUTODESK_DATA_API = "https://developer.api.autodesk.com/data/v1"
  AUTODESK_OSS_API  = "https://developer.api.autodesk.com/oss/v2"
"""

from __future__ import annotations

import time
import urllib.parse
from pathlib import Path
from typing import Any

import httpx

# --- trimmed helpers (pattern only; wire _auth_headers / _raise_aps from real module) ---


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
      - new: if same name exists, upload under a unique name
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
    except Exception:
        pass

    if existing_item_id and mode == "new":
        filename = _unique_folder_filename(folder_items, filename)
        existing_item_id = ""

    storage = _create_storage(access_token, project_id=project_id, folder_id=folder_id, filename=filename)
    storage_id = storage["data"]["id"]
    bucket_key, object_name = _storage_id_parts(storage_id)
    _upload_object_to_signed_s3(access_token, bucket_key=bucket_key, object_name=object_name, data=data)

    if existing_item_id:
        version = _create_version(
            access_token,
            project_id=project_id,
            item_id=existing_item_id,
            storage_id=storage_id,
            filename=filename,
        )
        version_data = version.get("data") or {}
        return {
            "item_id": existing_item_id,
            "version_id": version_data.get("id"),
            "name": filename,
            "storage_id": storage_id,
            "web_url": ((version_data.get("links") or {}).get("webView") or {}).get("href"),
            "updated_existing": True,
            "conflict_mode": "replace",
        }

    item = _create_item(
        access_token,
        project_id=project_id,
        folder_id=folder_id,
        storage_id=storage_id,
        filename=filename,
    )
    item_data = item.get("data") or {}
    return {
        "item_id": item_data.get("id"),
        "name": filename,
        "storage_id": storage_id,
        "web_url": ((item_data.get("links") or {}).get("webView") or {}).get("href"),
        "conflict_mode": mode,
        "created_new": True,
    }


def _unique_folder_filename(folder_items: list[dict[str, Any]], filename: str) -> str:
    taken = {str(item.get("name") or "").casefold() for item in folder_items}
    if filename.casefold() not in taken:
        return filename
    stem = Path(filename).stem
    suffix = Path(filename).suffix or ".step"
    for n in range(2, 200):
        candidate = f"{stem} ({n}){suffix}"
        if candidate.casefold() not in taken:
            return candidate
    return f"{stem}-{int(time.time())}{suffix}"


def _upload_object_to_signed_s3(access_token: str, *, bucket_key: str, object_name: str, data: bytes) -> dict[str, Any]:
    AUTODESK_OSS_API = "https://developer.api.autodesk.com/oss/v2"
    encoded_bucket = urllib.parse.quote(bucket_key, safe="")
    encoded_object = urllib.parse.quote(object_name, safe="")
    signed = httpx.get(
        f"{AUTODESK_OSS_API}/buckets/{encoded_bucket}/objects/{encoded_object}/signeds3upload",
        headers={"Authorization": f"Bearer {access_token}"},
        params={"minutesExpiration": 10, "useAcceleration": "true"},
        timeout=30,
    )
    signed.raise_for_status()
    payload = signed.json()
    urls = payload.get("urls") or []
    upload_key = payload.get("uploadKey")
    if not urls or not upload_key:
        raise RuntimeError("Autodesk did not return a signed S3 upload URL.")

    put = httpx.put(urls[0], content=data, headers={"Content-Type": "application/octet-stream"}, timeout=180)
    put.raise_for_status()

    complete = httpx.post(
        f"{AUTODESK_OSS_API}/buckets/{encoded_bucket}/objects/{encoded_object}/signeds3upload",
        headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
        json={"uploadKey": upload_key},
        timeout=60,
    )
    complete.raise_for_status()
    return complete.json()


def _create_storage(access_token: str, *, project_id: str, folder_id: str, filename: str) -> dict[str, Any]:
    AUTODESK_DATA_API = "https://developer.api.autodesk.com/data/v1"
    resp = httpx.post(
        f"{AUTODESK_DATA_API}/projects/{urllib.parse.quote(project_id, safe='')}/storage",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/vnd.api+json",
        },
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
    resp.raise_for_status()
    return resp.json()


def _create_version(
    access_token: str, *, project_id: str, item_id: str, storage_id: str, filename: str
) -> dict[str, Any]:
    AUTODESK_DATA_API = "https://developer.api.autodesk.com/data/v1"
    resp = httpx.post(
        f"{AUTODESK_DATA_API}/projects/{urllib.parse.quote(project_id, safe='')}/versions",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/vnd.api+json",
        },
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
    resp.raise_for_status()
    return resp.json()


def _create_item(
    access_token: str, *, project_id: str, folder_id: str, storage_id: str, filename: str
) -> dict[str, Any]:
    AUTODESK_DATA_API = "https://developer.api.autodesk.com/data/v1"
    resp = httpx.post(
        f"{AUTODESK_DATA_API}/projects/{urllib.parse.quote(project_id, safe='')}/items",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/vnd.api+json",
        },
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
    resp.raise_for_status()
    return resp.json()


def _storage_id_parts(storage_id: str) -> tuple[str, str]:
    marker = "urn:adsk.objects:os.object:"
    object_path = storage_id[len(marker) :] if storage_id.startswith(marker) else storage_id.rsplit(":", 1)[-1]
    if "/" not in object_path:
        raise RuntimeError(f"Unexpected Autodesk storage id: {storage_id}")
    bucket_key, object_name = object_path.split("/", 1)
    return bucket_key, object_name


# Stub — real list_folder_contents lives in autodesk_oauth.py
def list_folder_contents(access_token: str, project_id: str, folder_id: str) -> dict[str, Any]:
    raise NotImplementedError("Copy list_folder_contents from backend/services/autodesk_oauth.py")
