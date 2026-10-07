"""Local purchase-list normalization; never fetch vendor pages during project load."""
from __future__ import annotations

from copy import deepcopy
import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


PURCHASE_LIST_RULES = """Parts List is a shopping list: one row per unique, sourced product purchase URL, with the total required purchase quantity. Keep a purchased module intact in the list; its modeled housing, PCB, terminals and internal components are not separate purchases. Repeated screws/washers share one product row. Use direct product links from retrieved sources; never invent links or reuse a reference assembly's URL for its subparts. Put datasheets/schematics in that product's docs, not in url. Keep unsourced requirements in questions and fabricated/custom bodies in the CAD assembly inventory, outside the shopping list. These shopping-list rules must not omit any requested geometry from the assembled model."""


def purchase_url(value):
    """Canonical product identity, excluding obvious non-product references.

    This is structural filtering, not a claim of live stock or verified fit.
    Keep functional query parameters (variant/SKU etc.) while dropping tracking.
    """
    try:
        parsed = urlsplit(str(value or "").strip()[:2000])
        host = (parsed.hostname or "").lower().removeprefix("www.")
        if parsed.scheme != "https" or not host or parsed.username or parsed.port not in (None, 443):
            return ""
    except ValueError:
        return ""
    path = parsed.path.rstrip("/")
    if host.startswith(("docs.", "documentation.", "support.")) or host in {"github.com", "raw.githubusercontent.com"}:
        return ""
    if re.search(r"\.(pdf|step|stp|stl|glb|svg|png|jpe?g|zip)$", path, re.I):
        return ""
    if re.search(r"/(docs|documentation|datasheets?|manuals?|search)(/|$)", path, re.I):
        return ""
    if re.fullmatch(r"(?:/(?:en(?:-\w+)?|products?|collections?|catalog|store|shop))*", path, re.I):
        return ""
    if re.fullmatch(r"(?:smile\.)?amazon\.[a-z.]+", host):
        match = re.search(r"/(?:dp|gp/product|gp/aw/d)/([A-Z0-9]{10})(?:/|$)", path, re.I)
        if not match:
            return ""
        return f"https://www.{host.removeprefix('smile.')}/dp/{match[1].upper()}"
    if host == "mcmaster.com":
        match = re.fullmatch(r"/([0-9]+[A-Za-z][0-9]+)", path)
        return f"https://www.mcmaster.com/{match[1].upper()}/" if match else ""
    query = [(k, v) for k, v in parse_qsl(parsed.query, keep_blank_values=True)
             if not k.lower().startswith("utm_") and k.lower() not in
             {"ref", "ref_", "tag", "fbclid", "gclid", "msclkid", "mc_cid", "mc_eid"}]
    # A fragment can encode a product variant; retain it except for tracking.
    fragment = "" if parsed.fragment.lower().startswith("utm_") else parsed.fragment
    return urlunsplit(("https", host, path, urlencode(sorted(query)), fragment))


def unique_purchases(rows, *, excluded_urls=()):
    """Keep stable IDs and source aliases; never sum duplicate geometry as orders."""
    excluded = {purchase_url(url) for url in excluded_urls}
    by_url = {}
    for source in rows:
        url = purchase_url(source.get("url"))
        if not url or url in excluded:
            continue
        if source.get("source_category") in {"custom_metal", "custom", "fabricated", "printed", "custom_printed"}:
            continue
        row = deepcopy(source)
        row["url"] = url
        row["docs"] = [d for d in row.get("docs", []) if purchase_url(d.get("url")) != url]
        if row.get("description") == row.get("name"):
            row["description"] = ""
        row["source_ids"] = list(dict.fromkeys([row["id"], *row.get("source_ids", [])]))[:1000]
        current = by_url.get(url)
        if current is None:
            by_url[url] = row
            continue
        current["source_ids"] = list(dict.fromkeys([*current["source_ids"], *row["source_ids"]]))[:1000]
        # An aggregate BOM quantity and individual mesh rows often coexist.
        # Adding them double counts hardware and even battery terminals as batteries.
        current["qty"] = max(current.get("qty", 1), row.get("qty", 1))
        for key in ("part_number", "description", "model_filename", "thumbnail_url", "step_url", "glb_url", "catalog_url", "compatibility"):
            if not current.get(key) and row.get(key):
                current[key] = row[key]
        for key in ("specs", "mounting"):
            current[key] = {**row.get(key, {}), **current.get(key, {})}
        docs = {d["url"]: d for d in [*current.get("docs", []), *row.get("docs", [])]}
        current["docs"] = list(docs.values())[:12]
    return list(by_url.values())
