from backend.frontend_aliases import ALIASES, resolve_frontend_rel


def test_legacy_html_and_assets_keep_public_urls():
    assert ALIASES["setup.html"] == "pages/setup.html"
    assert ALIASES["database.html"] == "pages/database.html"
    assert ALIASES["database-configuration.html"] == "pages/database.html"
    assert ALIASES["setup-marketplace.html"] == "pages/setup-marketplace.html"
    assert ALIASES["marketplace-roadmap.html"] == "pages/marketplace-roadmap.html"
    assert ALIASES["app.js"] == "studio/app.js"
    assert ALIASES["favicon.ico"] == "assets/brand/favicon.ico"
    assert ALIASES["favicon-48.png"] == "assets/brand/favicon-48.png"
    assert ALIASES["canvas-save-hint.svg"] == "assets/studio/canvas-save-hint.svg"
    assert ALIASES["record-done-hint.svg"] == "assets/studio/record-done-hint.svg"
    assert ALIASES["record-done-hint.gif"] == "assets/studio/record-done-hint.gif"
    assert ALIASES["shared-projects-hint.gif"] == "assets/studio/shared-projects-hint.gif"
    assert ALIASES["render-studio-chrome-wordmark.png"] == "assets/brand/render-studio-chrome-wordmark.png"
    assert ALIASES["white-paper.html"] == "pages/white-paper.html"
    assert ALIASES["opensource.html"] == "pages/opensource.html"
    assert ALIASES["opensource"] == "pages/opensource.html"
    assert ALIASES["suggestions.html"] == "pages/suggestions.html"
    assert ALIASES["team-chat.html"] == "pages/team-chat.html"
    assert resolve_frontend_rel("admin-dashboard.html") == "pages/admin-dashboard.html"
    assert resolve_frontend_rel("studio/app.js") == "studio/app.js"


def test_archive_and_bak_are_not_aliased():
    assert "viewport-xr.js.bak-heavy-20260805" not in ALIASES
    assert resolve_frontend_rel("_archive/viewport-xr.js.bak-heavy-20260805").startswith("_archive/")
