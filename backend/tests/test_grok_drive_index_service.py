from backend.services import grok_drive_index_service as index


class _Response:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return self.payload


def test_repeated_query_reuses_embedding(monkeypatch):
    calls = {"embed": 0, "rpc": 0}

    def fake_embed(texts):
        calls["embed"] += 1
        return [[0.0] * index.EMBED_DIM for _ in texts]

    def fake_open(request, timeout=0):
        calls["rpc"] += 1
        return _Response(b"[]")

    index.embed_query.cache_clear()
    monkeypatch.setattr(index, "embed", fake_embed)
    monkeypatch.setattr(index.urllib.request, "urlopen", fake_open)
    monkeypatch.setattr(index, "project_url", lambda: "https://example.supabase.co")
    monkeypatch.setattr(index, "service_key", lambda: "test-key")

    assert index.search("same robot query")["ok"] is True
    assert index.search("same robot query")["ok"] is True
    assert calls == {"embed": 1, "rpc": 2}
    index.embed_query.cache_clear()
