"""Searchable Management / Foundry / Studio settings for admin dashboards."""

from __future__ import annotations

from typing import Any

SETTINGS: tuple[dict[str, Any], ...] = (
    {
        "id": "admin-analytics",
        "title": "Analytics",
        "description": "Site overview, activity charts, spend, and success rate",
        "keywords": "insights overview metrics charts spend tokens",
        "href": "/admin-dashboard.html#analytics",
        "group": "Management",
        "dashboard": "admin",
    },
    {
        "id": "admin-network",
        "title": "Network",
        "description": "Collaboration graph and workspace connections",
        "keywords": "graph collab brain network",
        "href": "/admin-dashboard.html#network",
        "group": "Management",
        "dashboard": "admin",
    },
    {
        "id": "admin-changelog",
        "title": "Changelog",
        "description": "Live CHANGELOG.md from the repo",
        "keywords": "updates history release notes",
        "href": "/admin-dashboard.html#changelog",
        "group": "Management",
        "dashboard": "admin",
    },
    {
        "id": "admin-users",
        "title": "Users / roles",
        "description": "Directory, role groups, and per-member permissions",
        "keywords": "people roles permissions export tools invite manager admin",
        "href": "/admin-dashboard.html#users",
        "group": "Management",
        "dashboard": "admin",
    },
    {
        "id": "admin-workspaces",
        "title": "Workspaces",
        "description": "Shared workspace graph and member weight",
        "keywords": "teams shared workspace",
        "href": "/admin-dashboard.html#workspaces",
        "group": "Management",
        "dashboard": "admin",
    },
    {
        "id": "admin-projects",
        "title": "Projects",
        "description": "Tracked project folders and sort",
        "keywords": "projects files sort",
        "href": "/admin-dashboard.html#projects",
        "group": "Management",
        "dashboard": "admin",
    },
    {
        "id": "admin-prompts",
        "title": "Prompts",
        "description": "Prompt history and model mix",
        "keywords": "prompts generations history",
        "href": "/admin-dashboard.html#prompts",
        "group": "Management",
        "dashboard": "admin",
    },
    {
        "id": "admin-training",
        "title": "Training",
        "description": "Training-ready models",
        "keywords": "training dataset models",
        "href": "/admin-dashboard.html#training",
        "group": "Management",
        "dashboard": "admin",
    },
    {
        "id": "admin-billing",
        "title": "Billing & trials",
        "description": "Trial credits, spend, and billing ops",
        "keywords": "billing credits trial stripe payments",
        "href": "/admin-dashboard.html#billing",
        "group": "Management",
        "dashboard": "admin",
    },
    {
        "id": "admin-notifications",
        "title": "Inbox notifications",
        "description": "Pager for new users, suggestions, and bugs",
        "keywords": "inbox pager unread suggestions bugs",
        "href": "/admin-dashboard.html#notifications",
        "group": "Management",
        "dashboard": "admin",
    },
    {
        "id": "admin-suggestions",
        "title": "Suggestions inbox",
        "description": "User ideas and feedback queue",
        "keywords": "ideas feedback requests inbox",
        "href": "/admin-dashboard.html#suggestions",
        "group": "Management",
        "dashboard": "admin",
    },
    {
        "id": "admin-new-users",
        "title": "New users",
        "description": "Recent signups to review",
        "keywords": "signup onboarding new users",
        "href": "/admin-dashboard.html#new-users",
        "group": "Management",
        "dashboard": "admin",
    },
    {
        "id": "admin-approvals",
        "title": "Approvals",
        "description": "Pending management approvals",
        "keywords": "approve deny queue",
        "href": "/admin-dashboard.html#approvals",
        "group": "Management",
        "dashboard": "admin",
    },
    {
        "id": "admin-agent",
        "title": "Render Agent activity",
        "description": "Admin feed of Render Agent chats",
        "keywords": "render agent assistant chat",
        "href": "/admin-dashboard.html#agent",
        "group": "Management",
        "dashboard": "admin",
    },
    {
        "id": "admin-settings-hub",
        "title": "Settings hub",
        "description": "Shortcuts to server, marketplace, debugger, and billing",
        "keywords": "settings hub ops",
        "href": "/admin-dashboard.html#settings",
        "group": "Server",
        "dashboard": "admin",
    },
    {
        "id": "server-links",
        "title": "Splash & toolbar links",
        "description": "Discord, Slack, GitHub, and X URLs on public chrome",
        "keywords": "discord slack github twitter x links splash toolbar",
        "href": "/admin-dashboard.html#server",
        "group": "Server",
        "dashboard": "admin",
    },
    {
        "id": "server-suggestion-routing",
        "title": "Suggestion routing",
        "description": "Email and Slack destinations for boot suggestions",
        "keywords": "suggestions email slack routing inbox info@",
        "href": "/admin-dashboard.html#server",
        "group": "Server",
        "dashboard": "admin",
    },
    {
        "id": "server-email-suggestions",
        "title": "Email suggestions",
        "description": "Send suggestion mail to the admin inbox",
        "keywords": "email_enabled smtp suggestions notify",
        "href": "/admin-dashboard.html#server",
        "group": "Server",
        "dashboard": "admin",
    },
    {
        "id": "server-feature-request-notify",
        "title": "Feature request notifications",
        "description": "Email sam@render3d.app and open a GitHub feature-request issue when an admin requests a missing setting",
        "keywords": "feature request github issue notify email sam super admin",
        "href": "/admin-dashboard.html#server",
        "group": "Server",
        "dashboard": "admin",
    },
    {
        "id": "server-instruction-files",
        "title": "Instruction files",
        "description": "Agent, ops, Foundry, and Cursor runbooks",
        "keywords": "runbooks instructions docs agents.md",
        "href": "/admin-dashboard.html#server",
        "group": "Server",
        "dashboard": "admin",
    },
    {
        "id": "marketplace-catalog",
        "title": "Marketplace catalog",
        "description": "Hub pull/publish and catalog enabled flags",
        "keywords": "marketplace catalog hub listings",
        "href": "/admin-dashboard.html#marketplace",
        "group": "Marketplace",
        "dashboard": "admin",
    },
    {
        "id": "marketplace-payments",
        "title": "Marketplace payments",
        "description": "Payouts, Stripe Connect, premium posts",
        "keywords": "payouts stripe connect premium",
        "href": "/admin-dashboard.html#marketplace",
        "group": "Marketplace",
        "dashboard": "admin",
    },
    {
        "id": "marketplace-prefs",
        "title": "Marketplace preferences",
        "description": "Guest browse, review listings, show models and knowledge",
        "keywords": "guest browse review listings models knowledge",
        "href": "/admin-dashboard.html#marketplace",
        "group": "Marketplace",
        "dashboard": "admin",
    },
    {
        "id": "admin-debugger",
        "title": "System debugger",
        "description": "XR perf logs and ops debugger",
        "keywords": "xr logs debugger headset",
        "href": "/admin-dashboard.html#debugger",
        "group": "Ops",
        "dashboard": "admin",
    },
    {
        "id": "studio-notes",
        "title": "Notes",
        "description": "Searchable Sam’s Notes on the dashboard and your notes in Developer settings",
        "keywords": "notes notepad sam dimos commands search",
        "href": "/admin-dashboard.html",
        "group": "Studio",
        "dashboard": "admin",
    },
    {
        "id": "foundry-pulse",
        "title": "Foundry Pulse",
        "description": "Developer desk status",
        "keywords": "foundry pulse developer desk",
        "href": "/foundry.html#pulse",
        "group": "Foundry",
        "dashboard": "foundry",
    },
    {
        "id": "foundry-prs",
        "title": "Pull requests",
        "description": "Linked GitHub PRs on the Foundry desk",
        "keywords": "github prs pull requests foundry",
        "href": "/foundry.html#prs",
        "group": "Foundry",
        "dashboard": "foundry",
    },
    {
        "id": "foundry-ideas",
        "title": "Foundry ideas",
        "description": "Email an idea to sam@render3d.app",
        "keywords": "ideas email administrator sam",
        "href": "/foundry.html#ideas",
        "group": "Foundry",
        "dashboard": "foundry",
    },
    {
        "id": "foundry-watchdogs",
        "title": "Watchdogs",
        "description": "Workspace automation watchdogs",
        "keywords": "watchdogs automation schedule email",
        "href": "/foundry.html#watchdogs",
        "group": "Foundry",
        "dashboard": "foundry",
    },
    {
        "id": "foundry-debugger",
        "title": "My debugger",
        "description": "XR Controls + FPS session logs on the Foundry desk",
        "keywords": "debugger xr logs foundry controls fps throttle gamepad",
        "href": "/foundry.html#debugger",
        "group": "Foundry",
        "dashboard": "foundry",
    },
    {
        "id": "pref-theme",
        "title": "Theme",
        "description": "Dark or light Studio UI",
        "keywords": "theme dark light appearance",
        "href": "/?openPrefs=general",
        "group": "Studio preferences",
        "dashboard": "studio",
    },
    {
        "id": "pref-robot-host-ip",
        "title": "Robot host IP",
        "description": "DIMOS / Quest PC or Raspberry Pi LAN IPv4 for https://IP:8443/teleop",
        "keywords": "dimos quest openarm raspberry pi host ip teleop robotics robot pc",
        "href": "/?openPrefs=robotics",
        "group": "Studio preferences",
        "dashboard": "studio",
    },
    {
        "id": "pref-imagine-count",
        "title": "Imagine image count",
        "description": "How many concept images Imagine generates",
        "keywords": "imagine images count",
        "href": "/?openPrefs=general",
        "group": "Studio preferences",
        "dashboard": "studio",
    },
    {
        "id": "pref-dxf-convert",
        "title": "Convert photos to DXF",
        "description": "Ask, auto, always DXF, or keep the photo",
        "keywords": "dxf convert drawings logos floorplans",
        "href": "/?openPrefs=general",
        "group": "Studio preferences",
        "dashboard": "studio",
    },
    {
        "id": "pref-foundry-toolbar",
        "title": "Developer dashboard toolbar",
        "description": "Show Foundry in the Studio top bar",
        "keywords": "foundry toolbar developer dashboard",
        "href": "/?openPrefs=general",
        "group": "Studio preferences",
        "dashboard": "studio",
    },
    {
        "id": "pref-email-chat",
        "title": "Chat alert emails",
        "description": "Email when mentioned or a thread needs attention",
        "keywords": "email chat alerts mentions notifications",
        "href": "/?openPrefs=notifications",
        "group": "Studio preferences",
        "dashboard": "studio",
    },
    {
        "id": "pref-email-purchases",
        "title": "Purchase alert emails",
        "description": "Receipts and marketplace purchase updates",
        "keywords": "email purchase credits marketplace",
        "href": "/?openPrefs=notifications",
        "group": "Studio preferences",
        "dashboard": "studio",
    },
    {
        "id": "pref-feature-request-notify",
        "title": "Feature request notifications",
        "description": "Super admin: email Sam and file a GitHub feature-request issue",
        "keywords": "feature request github notify super admin preferences",
        "href": "/?openPrefs=notifications",
        "group": "Studio preferences",
        "dashboard": "studio",
    },
    {
        "id": "pref-workspace-invites",
        "title": "Workspace invite emails",
        "description": "Email when invited to a workspace",
        "keywords": "workspace invites email",
        "href": "/?openPrefs=notifications",
        "group": "Studio preferences",
        "dashboard": "studio",
    },
)


SETTING_ASK_RE = (
    r"\b(setting|settings|preference|preferences|toggle|option|config|configuration)\b"
)


def list_settings() -> list[dict[str, Any]]:
    return [dict(item) for item in SETTINGS]


def _haystack(item: dict[str, Any]) -> str:
    return " ".join(
        str(item.get(key) or "")
        for key in ("id", "title", "description", "keywords", "group")
    ).lower()


def search_settings(query: str, *, limit: int = 12) -> list[dict[str, Any]]:
    raw = " ".join(str(query or "").lower().split())
    if not raw:
        return []
    tokens = [tok for tok in raw.replace("/", " ").split() if tok]
    scored: list[tuple[int, dict[str, Any]]] = []
    for item in SETTINGS:
        blob = _haystack(item)
        title = str(item.get("title") or "").lower()
        if raw in title:
            score = 100
        elif raw in blob:
            score = 60
        elif tokens and all(tok in blob for tok in tokens):
            score = 40 + sum(8 if tok in title else 2 for tok in tokens)
        else:
            continue
        scored.append((score, dict(item)))
    scored.sort(key=lambda pair: (-pair[0], pair[1]["title"]))
    return [item for _score, item in scored[: max(1, min(int(limit or 12), 24))]]


def looks_like_setting_question(text: str) -> bool:
    import re

    return bool(re.search(SETTING_ASK_RE, str(text or ""), re.I))
