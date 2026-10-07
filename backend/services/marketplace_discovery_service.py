"""Read-only, catalog-grounded discovery for Render Agent.

Rank existing public listings with explainable token/synonym matches. Catalog
text is data, never a prompt, and search cannot buy, install, or publish assets.
"""
from __future__ import annotations

import re
from urllib.parse import quote
from typing import Any

from backend.services import marketplace_catalog_service as catalog
from backend.services import marketplace_config_service as config

STOP_WORDS = set("a an and are as at be can could do find for from give have help i in is it like looking me my need of on or please recommend search show similar some that the there this to want what which with would you your marketplace market store product products something anything buy download render studio".split())
KINDS = {"model": {"model", "models", "3d", "cad", "asset", "assets"}, "agent": {"agent", "agents"}, "knowledge": {"knowledge", "guide", "guides", "documentation"}, "skill": {"skill", "skills"}}
SYNONYMS = (
    {"robot", "robotic", "robotics", "manipulator"},
    {"circuit", "electronic", "electronics", "wiring"},
    {"architecture", "building", "house", "architectural"},
    {"fixture", "jig", "mount", "holder", "bracket"},
    {"gripper", "claw", "grabber"},
    {"gear", "gearing", "cog"},
    {"simulate", "simulation", "simulator"},
    {"print", "printable", "printing"},
    {"skill", "prompt", "workflow", "instruction"},
)


def tokens(text: str) -> list[str]:
    words = re.findall(r"[^\W_]+", str(text).casefold(), flags=re.UNICODE)
    return list(dict.fromkeys(word[:-1] if len(word) > 4 and word.endswith("s") and not word.endswith("ss") else word for word in words))


def query_plan(query: str, kind: str = "") -> dict[str, Any]:
    raw = set(re.findall(r"[^\W_]+", query.casefold(), flags=re.UNICODE))
    requested = kind or next((name for name, words in KINDS.items() if raw & words), "")
    kind_words = set().union(*KINDS.values())
    terms = [term for term in tokens(query) if term not in STOP_WORDS and term not in kind_words and term not in {"free", "paid"}][:24]
    groups = []
    for term in terms:
        group = {term}
        for synonyms in SYNONYMS:
            normalized = set(tokens(" ".join(synonyms)))
            if term in normalized:
                group |= normalized
        groups.append(group)
    return {"kind": requested, "terms": terms, "groups": groups, "access": "free" if "free" in raw else "paid" if "paid" in raw else ""}


def rank_matches(listings: list[dict[str, Any]], query: str, *, kind: str = "", limit: int = 6) -> list[dict[str, Any]]:
    plan = query_plan(query, kind)
    scored = []
    for rank, item in enumerate(listings):
        item_kind = str(item.get("kind") or "model")
        if item_kind not in {"model", "agent", "knowledge"} or not item.get("id") or not item.get("name"):
            continue
        if plan["kind"] == "skill" and item_kind not in {"agent", "knowledge"}:
            continue
        if plan["kind"] in {"model", "agent", "knowledge"} and item_kind != plan["kind"]:
            continue
        price = max(0, int(item.get("price_cents") or 0))
        access = item.get("access_mode") or "free"
        if plan["access"] == "free" and (price > 0 or access != "free"):
            continue
        if plan["access"] == "paid" and price <= 0 and access != "paid":
            continue
        title = set(tokens(item.get("name") or ""))
        metadata = set(tokens(" ".join(str(item.get(k) or "") for k in ("tagline", "category", "tags"))))
        body = set(tokens(str(item.get("description") or "")[:20000]))
        hits, score = [], 0
        for term, group in zip(plan["terms"], plan["groups"]):
            if group & (title | metadata | body):
                hits.append(term)
                score += 8 if term in title else 5 if group & title else 3 if group & metadata else 1
        if plan["terms"] and not hits:
            continue
        # Coverage dominates popularity, which is already the catalog's input order.
        coverage = len(hits) / max(1, len(plan["terms"]))
        scored.append((coverage * 100 + score, -rank, item, hits))
    scored.sort(key=lambda row: (row[0], row[1]), reverse=True)
    results = []
    for _, _, item, hits in scored[:limit]:
        k = str(item.get("kind") or "model")
        ident = quote(str(item.get("slug") or item["id"]), safe="")
        owner = item.get("owner") or {}
        results.append({
            "id": item["id"], "kind": k, "name": item["name"],
            "description": str(item.get("tagline") or item.get("description") or "")[:320],
            "thumbnail_url": item.get("thumbnail_url") or "", "category": item.get("category") or k,
            "price_cents": max(0, int(item.get("price_cents") or 0)), "currency": item.get("currency") or "usd",
            "access_mode": item.get("access_mode") or "free", "seller": owner.get("name") or owner.get("handle") or "",
            "href": f"/marketplace.html#/p/{k}/{ident}", "matched_terms": hits,
        })
    return results


def discover(query: str, *, user_id: str | None = None, kind: str = "", limit: int = 6) -> dict[str, Any]:
    cfg = config.public_config()
    response: dict[str, Any] = {"query": query, "listings": [], "search_url": "/marketplace.html", "source": "marketplace_catalog"}
    if not cfg.get("enabled"):
        return {**response, "disabled": True}
    if not cfg.get("guest_browse_enabled", True) and not user_id:
        return {**response, "login_required": True}
    # Public results only, even for sellers/admins; never recommend pending drafts.
    listings = catalog.list_catalog(user_id=user_id, include_pending=False, mine_only=False, sort="rank")
    response["listings"] = rank_matches(listings, query, kind=kind, limit=limit)
    response["search_url"] = "/marketplace.html?q=" + quote(query, safe="")
    response["show_prices"] = cfg.get("show_prices", True)
    response["matching"] = "Catalog keywords and related terms"
    return response
