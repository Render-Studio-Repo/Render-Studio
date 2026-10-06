"""
Marketplace Hub API — optional standalone service.

This folder is a stub you can extract into its own Git repo:

  Suggested repo name:  render-marketplace-hub
  Suggested host:       marketplace.render3d.app   (or keep using render3d.app)

You do NOT need a listings folder. Instances POST JSON listings to this API.
Render Studio already serves the same contract at:

  https://render3d.app/api/marketplace/hub/v1

Run this stub separately only if you want the hub off the CAD instance:

  cd services/marketplace-hub
  uvicorn app:app --host 0.0.0.0 --port 8090

Env:
  MARKETPLACE_HUB_TOKEN   shared bearer token instances send
  HUB_DATA_DIR            sqlite directory (default ./data)
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel
from pydantic_settings import BaseSettings


class HubSettings(BaseSettings):
    marketplace_hub_token: str = ""
    hub_data_dir: str = "data"


settings = HubSettings()
app = FastAPI(title="Render Marketplace Hub", version="1.0.0")
DB = Path(settings.hub_data_dir) / "hub.db"


def _conn() -> sqlite3.Connection:
    DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB))
    conn.row_factory = sqlite3.Row
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS listings (
          id TEXT PRIMARY KEY,
          instance_id TEXT NOT NULL,
          origin_listing_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          slug TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          ranking_score REAL NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL,
          UNIQUE (instance_id, origin_listing_id, kind)
        )
        """
    )
    conn.commit()
    return conn


def _auth(authorization: str | None) -> None:
    token = (settings.marketplace_hub_token or "").strip()
    if not token:
        return
    bearer = (authorization or "")[7:].strip() if (authorization or "").lower().startswith("bearer ") else ""
    if bearer != token:
        raise HTTPException(401, "Invalid hub token")


class ListingBody(BaseModel):
    listing: dict


class RegisterBody(BaseModel):
    instance_id: str | None = None
    name: str = ""
    public_base_url: str = ""


@app.get("/health")
def health():
    return {"ok": True, "service": "render-marketplace-hub"}


@app.get("/api/marketplace/hub/v1/listings")
def list_listings(q: str = "", kind: str | None = None, authorization: str | None = Header(default=None)):
    _auth(authorization)
    with _conn() as conn:
        rows = conn.execute(
            "SELECT payload_json FROM listings ORDER BY ranking_score DESC, updated_at DESC LIMIT 200"
        ).fetchall()
    needle = (q or "").lower()
    out = []
    for row in rows:
        payload = json.loads(row["payload_json"])
        if kind and payload.get("kind") != kind:
            continue
        if needle:
            blob = " ".join(str(payload.get(k) or "") for k in ("name", "tagline", "slug")).lower()
            if needle not in blob:
                continue
        out.append(payload)
    return {"listings": out}


@app.post("/api/marketplace/hub/v1/listings")
def publish(
    body: ListingBody,
    authorization: str | None = Header(default=None),
    x_render_instance_id: str | None = Header(default=None),
):
    _auth(authorization)
    listing = body.listing
    instance_id = x_render_instance_id or str(listing.get("instance_id") or "")
    origin = str(listing.get("id") or "")
    if not instance_id or not origin:
        raise HTTPException(422, "instance_id and listing.id required")
    now = datetime.now(timezone.utc).isoformat()
    row_id = f"{instance_id}:{listing.get('kind')}:{origin}"
    with _conn() as conn:
        conn.execute(
            """
            INSERT INTO listings (id, instance_id, origin_listing_id, kind, slug, payload_json, ranking_score, updated_at)
            VALUES (?,?,?,?,?,?,?,?)
            ON CONFLICT(instance_id, origin_listing_id, kind) DO UPDATE SET
              payload_json=excluded.payload_json,
              ranking_score=excluded.ranking_score,
              updated_at=excluded.updated_at
            """,
            (
                row_id,
                instance_id,
                origin,
                str(listing.get("kind") or "model"),
                str(listing.get("slug") or origin),
                json.dumps(listing),
                float(listing.get("ranking_score") or 0),
                now,
            ),
        )
        conn.commit()
    return {"ok": True, "id": row_id}


@app.post("/api/marketplace/hub/v1/instances")
def register(body: RegisterBody, authorization: str | None = Header(default=None)):
    _auth(authorization)
    return {
        "ok": True,
        "instance_id": body.instance_id or str(uuid.uuid4()),
        "token": hashlib.sha256((body.instance_id or "new").encode()).hexdigest()[:24],
    }
