"""Index / search the Grok Bot Drive corpus in Supabase (pgvector + FTS).

Does not belong on the CAD hot path. Fleet search: grok_drive_search MCP.
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from functools import lru_cache
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[2]
FOLDER_ID = "1knAIlz5TwDWJReRt6QnaFJaV69EA5VmK"
FOLDER_URL = "https://drive.google.com/drive/folders/1knAIlz5TwDWJReRt6QnaFJaV69EA5VmK"
EMBED_MODEL = "text-embedding-3-small"
EMBED_DIM = 1536
CHUNK = 900


def _env(name: str) -> str:
    return (os.environ.get(name) or "").strip()


def project_url() -> str:
    return _env("SUPABASE_URL").rstrip("/")


def service_key() -> str:
    for name in ("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_KEY", "SUPABASE_SECRET_KEY"):
        raw = _env(name)
        if raw and not raw.startswith("sbp_"):
            return raw
    return ""


def _headers() -> dict[str, str]:
    return {
        "apikey": service_key(),
        "Authorization": "Bearer " + service_key(),
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=representation",
    }


def chunk_text(text: str) -> list[str]:
    text = re.sub(r"\s+", " ", (text or "").strip())
    if not text:
        return []
    out = []
    i = 0
    while i < len(text):
        out.append(text[i : i + CHUNK])
        i += CHUNK - 80
    return out[:40]


def embed(texts: list[str]) -> list[list[float]]:
    key = _env("OPENAI_API_KEY")
    if not key:
        raise RuntimeError("OPENAI_API_KEY missing")
    body = json.dumps({"model": EMBED_MODEL, "input": texts}).encode()
    req = urllib.request.Request(
        "https://api.openai.com/v1/embeddings",
        data=body,
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        data = json.loads(resp.read().decode())
    rows = sorted(data.get("data") or [], key=lambda r: int(r.get("index") or 0))
    return [list(r.get("embedding") or []) for r in rows]


@lru_cache(maxsize=256)
def embed_query(text: str) -> tuple[float, ...]:
    """Cache repeated search embeddings without retaining document-ingest batches."""
    vectors = embed([text])
    return tuple(vectors[0]) if vectors else ()


def upsert_chunks(rows: list[dict[str, Any]]) -> int:
    url = project_url() + "/rest/v1/grok_drive_index"
    req = urllib.request.Request(url, data=json.dumps(rows).encode(), headers=_headers(), method="POST")
    with urllib.request.urlopen(req, timeout=90) as resp:
        body = resp.read().decode()
    try:
        parsed = json.loads(body) if body else []
        return len(parsed) if isinstance(parsed, list) else 1
    except json.JSONDecodeError:
        return len(rows)


def search(query: str, limit: int = 8) -> dict[str, Any]:
    q = (query or "").strip()[:400]
    if not q:
        return {"ok": False, "error": "query required"}
    n = max(1, min(int(limit or 8), 20))
    hits: list[dict[str, Any]] = []
    try:
        vec = list(embed_query(q))
        if len(vec) != EMBED_DIM:
            raise RuntimeError("embedding response has the wrong dimensions")
        rpc = project_url() + "/rest/v1/rpc/match_grok_drive"
        req = urllib.request.Request(
            rpc,
            data=json.dumps({"query_embedding": vec, "match_count": n}).encode(),
            headers=_headers(),
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            hits = json.loads(resp.read().decode() or "[]")
    except Exception as exc:
        vec_err = str(exc)[:180]
        try:
            rpc = project_url() + "/rest/v1/rpc/search_grok_drive"
            req = urllib.request.Request(
                rpc,
                data=json.dumps({"query_text": q, "match_count": n}).encode(),
                headers=_headers(),
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                hits = json.loads(resp.read().decode() or "[]")
            return {"ok": True, "mode": "fts", "folder": FOLDER_URL, "hits": hits, "note": "vector miss: " + vec_err}
        except Exception as exc2:
            return {"ok": False, "error": vec_err + " / " + str(exc2)[:180]}
    return {"ok": True, "mode": "vector", "folder": FOLDER_URL, "hits": hits}


def ingest_doc(file_id: str, title: str, url: str, layer: str, text: str) -> int:
    chunks = chunk_text(text)
    if not chunks:
        return 0
    vectors = embed(chunks)
    payload = []
    for i, (content, vec) in enumerate(zip(chunks, vectors)):
        if len(vec) != EMBED_DIM:
            continue
        payload.append({
            "folder_id": FOLDER_ID,
            "file_id": file_id,
            "title": title[:240],
            "layer": layer,
            "url": url,
            "chunk_ix": i,
            "content": content[:4000],
            "embedding": vec,
        })
    if not payload:
        return 0
    return upsert_chunks(payload)
