import json
import urllib.request
from pathlib import Path

import pytest

from backend.services import link_preview as links, wiring_component_sources as sources, parts_workspace as parts
from backend.services.wiring_service import _is_step_dir_shield, COMMON_DRIVER_PROFILES


@pytest.fixture(autouse=True)
def no_preview_dns(monkeypatch):
    monkeypatch.setattr(links, "_is_blocked_host", lambda host: host in {None, "localhost", "127.0.0.1", "169.254.169.254"})


def test_metadata_amazon_and_jsonld():
    data = links.parse_preview('<title>Store</title><span id="productTitle">Exact Board V2</span><meta content="Pins and terminals" property="og:description"><meta content="/board.jpg" property="og:image"><link href="/icon.png" rel="icon">', "https://example.com/item")
    assert data["title"] == "Exact Board V2"
    assert data["image"] == "https://example.com/board.jpg"
    assert data["description"] == "Pins and terminals"
    data = links.parse_preview('<script type="application/ld+json">{"@type":"Product","name":"Module 123","description":"Exact revision","image":["/module.jpg"]}</script>', "https://example.com")
    assert data["title"] == "Module 123"
    assert data["image"] == "https://example.com/module.jpg"


@pytest.mark.parametrize("url", ["http://127.0.0.1/x", "https://localhost", "http://169.254.169.254", "https://user:pass@example.com", "https://example.com:8001/x", "javascript:alert(1)"])
def test_public_url_blocks_internal_or_active_urls(url):
    assert links.public_url(url) == ""


def test_redirect_is_checked_before_request():
    with pytest.raises(ValueError, match="Blocked redirect"):
        links.PublicRedirect().redirect_request(urllib.request.Request("https://example.com"), None, 302, "Moved", {}, "http://127.0.0.1/private")


def test_connection_pins_public_ip_and_rejects_rebinding(monkeypatch):
    monkeypatch.setattr(links.socket, "getaddrinfo", lambda *a, **k: [(2,1,6,"",("93.184.216.34",443))])
    connected = []
    monkeypatch.setattr(links.socket, "create_connection", lambda target, *args: connected.append(target) or "socket")
    assert links.public_socket("example.com",443,8) == "socket"
    assert connected == [("93.184.216.34",443)]
    monkeypatch.setattr(links.socket, "getaddrinfo", lambda *a, **k: [(2,1,6,"",("127.0.0.1",443))])
    with pytest.raises(ValueError): links.public_socket("example.com",443,8)
    assert len(connected) == 1


def test_unavailable_preview_keeps_original_variant_url(monkeypatch):
    url = "https://www.amazon.com/dp/B0BM3BFZ35?th=1&variant=2"
    monkeypatch.setattr(links, "fetch_public", lambda *a, **k: (_ for _ in ()).throw(ValueError("blocked")))
    links._cache.clear()
    data = links.preview(url)
    assert data["url"] == url
    assert not data["available"] and "B0BM3BFZ35" in data["title"]


def test_add_link_idempotent_and_categorized(tmp_path, monkeypatch):
    monkeypatch.setattr(parts, "get_workspace", lambda root: parts._read(root))
    row = {"name": "Control board", "url": "https://example.com/board", "category": "electronics"}
    assert parts.add_link(tmp_path, row)["added"]
    assert not parts.add_link(tmp_path, row)["added"]
    assert len(json.loads((tmp_path / "Parts List/Electronics/parts.json").read_text())["parts"]) == 1


FZP = b'''<module><title>Exact board 123</title><connectors>
<connector id="connector1" name="D13/SCK"><views><breadboardView><p svgId="connector1pin" terminalId="connector1terminal"/></breadboardView></views></connector>
<connector id="connector2" name="GND"><views><breadboardView><p svgId="connector2pin"/></breadboardView></views></connector>
<connector id="connector3" name="Unknown"><views><breadboardView><p svgId="missing"/></breadboardView></views></connector>
</connectors></module>'''
SVG = b'''<svg viewBox="0 0 100 100" width="10mm" height="10mm"><g transform="translate(10,20) scale(2)"><rect id="connector1terminal" x="4" y="4" width="2" height="2" style="fill:#123456;stroke:#fff"/></g><circle id="connector2pin" cx="75" cy="80" r="2"/></svg>'''
SOURCE = {"name": "board123", "url": "https://example.com/part", "repo": "test/parts", "license": "CC-BY-SA-3.0"}


def test_fritzing_pin_transforms_and_digital_aliases():
    profile = sources.fritzing_profile(FZP, SVG, SOURCE)
    assert profile["connectors"][0]["x"] == .2
    assert profile["connectors"][0]["y"] == .3
    assert profile["unresolved_connectors"] == ["Unknown"]
    assert profile["drawing_width_mm"] == 10
    c = {"type": "arduino-uno"}
    sources.bind_profile(c, profile)
    assert c["pin_layout"][0]["id"] == "d13"
    assert c["pin_layout"][1]["id"] == "gnd"
    assert 'fill="#123456"' in profile["svg"]


def test_svg_removes_scripts_events_external_resources():
    safe = sources.sanitize_svg('<svg viewBox="0 0 20 20" onload="alert(1)"><script>alert(1)</script><image href="http://127.0.0.1"/><foreignObject><iframe/></foreignObject><path d="M0 0L2 2" fill="url(https://bad)"/></svg>')
    assert not any(bad in safe for bad in ["onload", "script", "image", "foreignObject", "https:"])
    with pytest.raises(ValueError): sources.xml(b'<!DOCTYPE svg [<!ENTITY a "bad">]><svg/>')


def test_library_mismatch_flags_wire_and_followup(monkeypatch):
    c = {"id": "c", "type": "sensor", "label": "Exact board 123", "source_url": "https://example.com/part"}
    sources.bind_profile(c, sources.fritzing_profile(FZP, SVG, SOURCE))
    monkeypatch.setattr(sources, "source_component", lambda c: c)
    schematic, _ = sources.enrich_schematic({"components": [c], "wires": [{"from": {"componentId": "c", "pinId": "invented"}, "to": {}}]})
    assert schematic["wires"][0]["needs_fix"]
    assert schematic["blocker"] and schematic["followup_questions"]


def test_ai_fallback_stays_illustrative_and_sanitized(monkeypatch):
    monkeypatch.setattr(sources, "source_component", lambda c: c)
    monkeypatch.setattr(sources, "research_component", lambda c: [])
    class AI:
        def _call_model(self, *a, **kw):
            return json.dumps({"components": [{"id":"x", "variant":"unknown", "svg":'<svg viewBox="0 0 100 50"><rect width="90" height="40"/></svg>', "unknowns":["Pinout missing"]}]}), {}
    schematic, _ = sources.enrich_schematic({"components": [{"id":"x", "label":"Motor 123", "type":"stepper", "source_url":"https://example.com/motor"}], "wires":[]}, AI())
    c = schematic["components"][0]
    assert c["breadboard"]["status"] == "illustration"
    assert c["breadboard"]["connectors"] == [] and "pin_layout" not in c
    assert schematic["blocker"]


def test_bare_carriers_do_not_invent_shield_jumper_headers():
    assert not _is_step_dir_shield({"type":"motor-driver", "label":"A4988"})
    assert _is_step_dir_shield({"type":"motor-driver", "label":"A4988 expansion shield"})
    assert "dir_v" not in COMMON_DRIVER_PROFILES["a4988"]["pin_map"]
    assert "vcc" not in COMMON_DRIVER_PROFILES["drv8825"]["pin_map"]


def test_auto_source_does_not_guess_manufacturer_or_revision(monkeypatch):
    monkeypatch.setattr(sources, "search_components", lambda *a: [{"name":"A4988", "url":"https://example.com", "license":"CC-BY-SA-3.0", "exact_tokens":True}])
    monkeypatch.setattr(sources, "import_candidate", lambda *a: {"variant":"Pololu A4988 carrier"})
    assert "breadboard" not in sources.source_component({"id":"x", "label":"A4988"})


def test_link_route_checks_project_access_before_fetch(monkeypatch):
    from fastapi import FastAPI, HTTPException
    from fastapi.testclient import TestClient
    from backend.auth import get_current_user
    from backend.routes import design_assistance as routes
    app = FastAPI(); app.include_router(routes.router)
    app.dependency_overrides[get_current_user] = lambda: {"id": "reader"}
    def denied(*a, **k): raise HTTPException(403, "Read-only project")
    monkeypatch.setattr(routes, "project", denied)
    monkeypatch.setattr(links, "preview", lambda *a: pytest.fail("Must not fetch before authorization"))
    response = TestClient(app).post("/api/design-assist/projects/p/parts/link", json={"url":"https://example.com"})
    assert response.status_code == 403


def test_source_import_rejects_unregistered_repo(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.auth import get_current_user
    from backend.routes import design_assistance as routes
    app = FastAPI(); app.include_router(routes.router)
    app.dependency_overrides[get_current_user] = lambda: {"id":"u"}
    monkeypatch.setattr(sources, "tree", lambda *a: pytest.fail("Unknown source cannot be fetched"))
    response = TestClient(app).post("/api/design-assist/wiring-sources/import", json={"repo":"evil/parts", "path":"../../private", "component":{}})
    assert response.status_code == 422
