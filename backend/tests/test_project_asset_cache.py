"""Project switches reuse only unchanged files; frontend reloads validate modules."""
import asyncio
import os
from pathlib import Path
from starlette.requests import Request
from backend.services.cad_service import list_project_files


def test_file_revision_survives_reopen_but_changes_on_same_size_edit(tmp_path):
    file = tmp_path / 'robot.glb'
    file.write_bytes(b'first')
    before = list_project_files(tmp_path)[0]
    assert list_project_files(tmp_path)[0]['version'] == before['version']
    file.write_bytes(b'other')
    stamp = file.stat().st_mtime_ns + 1_000_000
    os.utime(file, ns=(stamp, stamp))
    after = list_project_files(tmp_path)[0]
    assert after['size'] == before['size']
    assert after['version'] != before['version']


def request(etag=''):
    return Request({'type': 'http', 'headers': [(b'if-none-match', etag.encode())]})


def test_unchanged_frontend_returns_304_and_same_url_edits_return_new_bytes(tmp_path):
    from backend.main import _frontend_bytes_response
    file = tmp_path / 'module.js'
    file.write_text('export const value = 1;')
    first = asyncio.run(_frontend_bytes_response(file, request()))
    assert first.status_code == 200
    assert first.headers['cache-control'] == 'public, no-cache, max-age=0, must-revalidate'
    assert first.headers['cloudflare-cdn-cache-control'] == 'no-store'
    same = asyncio.run(_frontend_bytes_response(file, request(first.headers['etag'])))
    assert same.status_code == 304 and same.body == b''
    file.write_text('export const value = 2;')
    stamp = file.stat().st_mtime_ns + 1_000_000
    os.utime(file, ns=(stamp, stamp))
    changed = asyncio.run(_frontend_bytes_response(file, request(first.headers['etag'])))
    assert changed.status_code == 200
    assert changed.body == b'export const value = 2;'
    assert changed.headers['etag'] != first.headers['etag']


def test_html_is_always_fresh_and_is_not_conditionally_cached(tmp_path):
    from backend.main import _frontend_bytes_response
    file = tmp_path / 'index.html'
    file.write_text('<html>new version</html>')
    result = asyncio.run(_frontend_bytes_response(file, request('*')))
    assert result.status_code == 200
    assert 'no-store' in result.headers['cache-control']


def test_static_cache_headers_survive_the_http_middleware(tmp_path, monkeypatch):
    from backend import main
    from fastapi.testclient import TestClient
    monkeypatch.setattr(main, 'FRONTEND', tmp_path)
    (tmp_path / 'module.js').write_text('export const value = 1;')
    client = TestClient(main.app)
    first = client.get('/module.js')
    assert first.status_code == 200
    assert first.headers['cache-control'] == 'public, no-cache, max-age=0, must-revalidate'
    assert first.headers['cdn-cache-control'] == 'no-store'
    same = client.get('/module.js', headers={'If-None-Match': first.headers['etag']})
    assert same.status_code == 304
    assert same.content == b''
    assert 'no-store' not in same.headers['cache-control']
