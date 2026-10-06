"""Local prompt chunk/vector lab. Run API on 127.0.0.1 only; not mounted in Studio.

Default vectors are deterministic lexical hashes for an offline baseline. Set
provider='openai' explicitly to send chunks to the embeddings API.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT / "data" / "prompt-vector-lab.sqlite3"
MODEL = "text-embedding-3-small"
WORD = re.compile(r"[a-z0-9_]+", re.I)


def sha(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class Chunk:
    chunk_id: str
    document_id: str
    version: str
    ordinal: int
    start_char: int
    end_char: int
    text: str
    content_hash: str


def chunk_source(document_id: str, source: str, max_chars: int = 900, overlap: int = 100) -> list[Chunk]:
    if not document_id or len(document_id) > 100 or not re.fullmatch(r"[A-Za-z0-9_.:-]+", document_id):
        raise ValueError("document_id must be 1-100 letters, digits, _, ., :, or -")
    if not source.strip():
        raise ValueError("source text is empty")
    if not 100 <= max_chars <= 4000 or not 0 <= overlap < max_chars // 2:
        raise ValueError("max_chars must be 100-4000 and overlap less than half of max_chars")
    version = sha(source)
    out: list[Chunk] = []
    start = 0
    while start < len(source):
        end = min(len(source), start + max_chars)
        if end < len(source):
            boundary = max(source.rfind(" ", start + max_chars // 2, end),
                           source.rfind("\n", start + max_chars // 2, end))
            if boundary > start:
                end = boundary + 1
        text = source[start:end]
        digest = sha(text)
        out.append(Chunk(
            chunk_id=f"{document_id}:{version[:12]}:{start}-{end}",
            document_id=document_id, version=version, ordinal=len(out),
            start_char=start, end_char=end, text=text, content_hash=digest,
        ))
        if end == len(source):
            break
        start = max(start + 1, end - overlap)
    return out


def local_vector(text: str, dimensions: int = 256) -> list[float]:
    """Feature hashing. Lexical baseline; not a semantic embedding."""
    vec = [0.0] * dimensions
    for word in WORD.findall(text.lower()):
        raw = hashlib.sha256(word.encode()).digest()
        index = int.from_bytes(raw[:4], "big") % dimensions
        vec[index] += 1.0
    norm = math.sqrt(sum(value * value for value in vec))
    return [value / norm for value in vec] if norm else vec


def embed(texts: list[str], provider: str) -> list[list[float]]:
    if provider == "local_hash":
        return [local_vector(text) for text in texts]
    if provider != "openai":
        raise ValueError("provider must be local_hash or openai")
    if not os.environ.get("OPENAI_API_KEY"):
        raise ValueError("OPENAI_API_KEY is required for provider=openai")
    # Explicit provider selection transmits these source chunks to OpenAI.
    from openai import OpenAI
    client = OpenAI()
    vectors: list[list[float]] = []
    for offset in range(0, len(texts), 32):
        batch = texts[offset:offset + 32]
        response = client.embeddings.create(model=MODEL, input=batch)
        rows = sorted(response.data, key=lambda row: row.index)
        vectors.extend([list(row.embedding) for row in rows])
    return vectors


def cosine(a: list[float], b: list[float]) -> float:
    if len(a) != len(b):
        return 0.0
    den = math.sqrt(sum(x * x for x in a) * sum(x * x for x in b))
    return sum(x * y for x, y in zip(a, b)) / den if den else 0.0


class PromptIndex:
    def __init__(self, path: Path = DEFAULT_DB):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._db() as db:
            db.executescript("""
              CREATE TABLE IF NOT EXISTS documents(
                document_id TEXT PRIMARY KEY, version TEXT NOT NULL, source TEXT NOT NULL
              );
              CREATE TABLE IF NOT EXISTS chunks(
                chunk_id TEXT PRIMARY KEY, document_id TEXT NOT NULL, version TEXT NOT NULL,
                ordinal INTEGER NOT NULL, start_char INTEGER NOT NULL, end_char INTEGER NOT NULL,
                text TEXT NOT NULL, content_hash TEXT NOT NULL, provider TEXT NOT NULL,
                vector_json TEXT NOT NULL
              );
              CREATE INDEX IF NOT EXISTS chunk_doc ON chunks(document_id, ordinal);
              CREATE INDEX IF NOT EXISTS chunk_provider_doc ON chunks(provider, document_id);
            """)

    def _db(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.path)
        db.row_factory = sqlite3.Row
        return db

    def ingest(self, document_id: str, source: str, provider: str = "local_hash",
               max_chars: int = 900, overlap: int = 100) -> dict[str, Any]:
        chunks = chunk_source(document_id, source, max_chars, overlap)
        vectors = embed([chunk.text for chunk in chunks], provider)
        with self._db() as db:
            db.execute("INSERT INTO documents VALUES (?,?,?) ON CONFLICT(document_id) DO UPDATE SET version=excluded.version,source=excluded.source",
                       (document_id, chunks[0].version, source))
            db.execute("DELETE FROM chunks WHERE document_id=?", (document_id,))
            db.executemany("INSERT INTO chunks VALUES (?,?,?,?,?,?,?,?,?,?)", [
                (c.chunk_id, document_id, c.version, c.ordinal, c.start_char,
                 c.end_char, c.text, c.content_hash, provider, json.dumps(v))
                for c, v in zip(chunks, vectors)
            ])
        return {"document_id": document_id, "version": chunks[0].version,
                "provider": provider, "chunk_count": len(chunks),
                "source_chars": len(source)}

    def chunks(self, document_id: str) -> list[dict[str, Any]]:
        with self._db() as db:
            rows = db.execute("SELECT chunk_id,document_id,version,ordinal,start_char,end_char,text,content_hash,provider FROM chunks WHERE document_id=? ORDER BY ordinal",
                              (document_id,)).fetchall()
        return [dict(row) for row in rows]

    def source(self, document_id: str) -> dict[str, Any]:
        with self._db() as db:
            row = db.execute("SELECT * FROM documents WHERE document_id=?", (document_id,)).fetchone()
        if row is None:
            raise KeyError(document_id)
        return dict(row)

    def decode(self, document_id: str) -> dict[str, Any]:
        """Verify each span and reconstruct the exact source despite overlap."""
        doc = self.source(document_id)
        rows = self.chunks(document_id)
        if not rows or rows[0]["start_char"] != 0:
            raise ValueError("chunk coverage starts after character zero")
        assembled = ""
        for row in rows:
            start, end = row["start_char"], row["end_char"]
            text = row["text"]
            if sha(text) != row["content_hash"] or doc["source"][start:end] != text:
                raise ValueError(f"corrupt source span: {row['chunk_id']}")
            if start > len(assembled):
                raise ValueError("gap in chunk coverage")
            assembled += text[len(assembled) - start:]
        if assembled != doc["source"] or sha(assembled) != doc["version"]:
            raise ValueError("decoded content differs from source")
        return {"document_id": document_id, "version": doc["version"],
                "verified": True, "source": assembled, "chunk_count": len(rows)}

    def search(self, query: str, provider: str = "local_hash", limit: int = 8,
               document_id: str | None = None) -> list[dict[str, Any]]:
        if not query.strip():
            raise ValueError("query is empty")
        limit = max(1, min(int(limit), 30))
        query_vec = embed([query], provider)[0]
        with self._db() as db:
            rows = db.execute(
                "SELECT chunk_id,document_id,version,ordinal,start_char,end_char,text,content_hash,vector_json FROM chunks WHERE provider=? AND (? IS NULL OR document_id=?)",
                (provider, document_id, document_id),
            ).fetchall()
        hits = []
        terms = {term.lower() for term in WORD.findall(query)}
        for row in rows:
            item = dict(row)
            vec = json.loads(item.pop("vector_json"))
            semantic = cosine(query_vec, vec)
            lexical = len(terms & set(WORD.findall(item["text"].lower()))) / max(1, len(terms))
            item["score"] = round(0.7 * semantic + 0.3 * lexical, 5)
            item["vector_score"] = round(semantic, 5)
            item["keyword_score"] = round(lexical, 5)
            hits.append(item)
        return sorted(hits, key=lambda item: item["score"], reverse=True)[:limit]


class IngestBody(BaseModel):
    document_id: str
    text: str = Field(min_length=1, max_length=2_000_000)
    provider: str = "local_hash"
    max_chars: int = 900
    overlap: int = 100


class SearchBody(BaseModel):
    query: str
    provider: str = "local_hash"
    limit: int = 8
    document_id: Optional[str] = None


app = FastAPI(title="Prompt Vector Lab", description="Local prototype; bind only to 127.0.0.1")


def _index() -> PromptIndex:
    return PromptIndex(Path(os.environ.get("PROMPT_VECTOR_DB", DEFAULT_DB)))


@app.post("/documents")
def api_ingest(body: IngestBody):
    try:
        return _index().ingest(body.document_id, body.text, body.provider, body.max_chars, body.overlap)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/documents/{document_id}/chunks")
def api_chunks(document_id: str):
    return {"chunks": _index().chunks(document_id)}


@app.get("/documents/{document_id}/decode")
def api_decode(document_id: str):
    try:
        return _index().decode(document_id)
    except KeyError as exc:
        raise HTTPException(404, "document not found") from exc
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@app.post("/search")
def api_search(body: SearchBody):
    try:
        return {"hits": _index().search(body.query, body.provider, body.limit, body.document_id)}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
