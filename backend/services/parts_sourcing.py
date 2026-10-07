"""Bounded, cached Parts Catalog fallback shared by CAD harnesses and Parts List.

Search results are evidence, never instructions. A catalog page is not a
verified product datasheet, and an available STEP does not establish fit.
"""
from __future__ import annotations

import copy
import json
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx

from backend.services import part_profiles_service as catalog
from backend.services import parts_workspace as parts
from backend.services.parts_sourcing_policy import PARTS_SOURCING_RULES

_CACHE = {}
_LOCK = threading.RLock()


def source_documents(raw):
    """Keep actual document URLs, including common API spellings; never infer one."""
    docs, seen = [], set()
    def add(label, url):
        link = parts.safe_url(url)
        if link and link not in seen and len(docs) < 12:
            docs.append({"label": str(label or "Source document")[:200], "url": link})
            seen.add(link)
    for source in (raw, raw.get("attributes") or {}):
        if not isinstance(source, dict): continue
        for keys, label in (
            (("datasheetUrl", "datasheet_url", "datasheet"), "Datasheet"),
            (("schematicUrl", "schematic_url", "schematic"), "Schematic"),
            (("documentationUrl", "documentation_url", "documentation"), "Documentation"),
            (("manufacturerUrl", "manufacturer_url"), "Manufacturer"),
        ):
            for key in keys:
                if isinstance(source.get(key), str): add(label, source[key])
        for key in ("documents", "docs"):
            for item in (source.get(key) or [])[:12]:
                if isinstance(item, dict): add(item.get("label") or item.get("title"), item.get("url"))
    return docs


def merge_source_metadata(previous, incoming):
    """Enrich a purchase without replacing its identity, quantity or bound mounts."""
    for key in ("step_url", "glb_url", "catalog_url", "thumbnail_url", "model_filename"):
        if incoming.get(key): previous[key] = incoming[key]
    previous["specs"] = {**incoming.get("specs", {}), **previous.get("specs", {})}
    previous["docs"] = source_documents({"docs": [*previous.get("docs", []), *incoming.get("docs", [])]})
    previous["source_ids"] = list(dict.fromkeys([previous["id"], *previous.get("source_ids", []), incoming["id"]]))
    return previous


def search(query, *, fallback=False):
    query = str(query or "").strip()[:180]
    if len(query) < 2:
        raise ValueError("Enter a component name or model number")
    key = (query.casefold(), bool(fallback))
    with _LOCK:
        cached = _CACHE.get(key)
        if cached and time.monotonic() - cached[0] < 600:
            return copy.deepcopy(cached[1])
    rows, errors = [], []
    try:
        response = httpx.get(f"{catalog.STEP_PARTS_ORIGIN}/v1/parts",
                             params={"q": query, "pageSize": 8}, timeout=6.0)
        response.raise_for_status()
        for raw in (response.json().get("items") or [])[:8]:
            item = catalog._part_from_api(raw)
            page = parts.safe_url(item.get("product_page_url")) or parts.safe_url(item.get("page_url"))
            if not page: continue
            rows.append({"id": item["id"], "name": item["name"], "title": item["name"],
                "url": page, "purchase_url": parts.purchase_url(item.get("product_page_url")), "catalog_url": parts.safe_url(item.get("page_url")),
                "step_url": parts.safe_url(item.get("step_url")), "glb_url": parts.safe_url(item.get("glb_url")),
                "thumbnail_url": parts.safe_url(item.get("png_url")), "specs": item.get("attributes") or {},
                "category": "electronics" if item.get("wiring_type") or "electronic" in str(item.get("category") or "").lower() else "mechanical",
                "part_number": str(raw.get("partNumber") or raw.get("part_number") or ""),
                "description": item.get("description") or "",
                "docs": source_documents(raw) + [{"label": "Catalog source", "url": parts.safe_url(item.get("page_url"))}],
                "provenance": {"provider": "step.parts", "catalog_id": str(item["id"]), "status": "catalog",
                    "note": "Catalog geometry; verify board variant, pinout and mounting pattern against manufacturer documentation."}})
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        errors.append("Parts Catalog unavailable: " + str(exc)[:200])
    if fallback and not rows:
        try:
            with ThreadPoolExecutor(max_workers=4) as pool:
                rows = list(pool.map(parts.enrich_source, parts.search_parts(query)[:8]))
        except (httpx.HTTPError, ValueError) as exc:
            errors.append("External source search unavailable: " + str(exc)[:200])
    result = {"query": query, "sources": rows, "errors": errors, "sourcing_order": ["official_manufacturer", "parts_catalog", "other_sources"], "stage": "parts_catalog"}
    with _LOCK:
        if len(_CACHE) >= 100: _CACHE.pop(next(iter(_CACHE)))
        _CACHE[key] = (time.monotonic(), result)
    return copy.deepcopy(result)


def import_for_agent(project_path, query, source_id):
    """Generation-only import of a retrieved ID. Search/Improve never calls this."""
    item = next((s for s in search(query)["sources"] if str(s["id"]) == str(source_id)), None)
    if not item or not item.get("step_url"):
        raise ValueError("Search the catalog and choose a returned source ID with STEP geometry")
    root = Path(project_path).resolve()
    part_id = "catalog:" + str(item["id"])
    with parts._LOCK:
        saved = next((p for p in parts.get_workspace(root)["parts"]
                      if p["id"] == part_id or part_id in p.get("source_ids", [])
                      or parts.purchase_url(p.get("url")) == parts.purchase_url(item["url"])), None)
    if saved and saved.get("model_filename"):
        existing = (root / saved["model_filename"]).resolve()
        if existing.is_relative_to(root) and existing.is_file():
            with parts._LOCK:
                data = parts.get_workspace(root)
                saved = next(p for p in data["parts"] if p["id"] == saved["id"])
                merge_source_metadata(saved, parts.clean_part({**item, "id": part_id}))
                parts._save(root, data)
            return {"filename": saved["model_filename"], "source": saved, "cached": True}
    # CAD-only references have profiles but intentionally no shopping row.
    for profile in catalog.load_all(root).values():
        source = profile.get("source") or {}
        existing = (root / str(profile.get("filename") or "")).resolve()
        if (str(source.get("id")) == str(item["id"]) and source.get("step_url") == item["step_url"]
                and existing.is_relative_to(root) and existing.is_file()):
            return {"filename": existing.relative_to(root).as_posix(), "source": profile, "cached": True}
    stem = re.sub(r"[^a-zA-Z0-9_-]+", "_", item["name"]).strip("_")[:70] or "catalog_part"
    import uuid
    dest = root / f"{stem}_{uuid.uuid4().hex[:8]}.step"
    try:
        catalog.download_asset(item["step_url"], dest, timeout=30)
        if dest.stat().st_size > 100 * 1024 * 1024: raise ValueError("Catalog STEP exceeds 100 MB")
        with dest.open("rb") as stream:
            if b"ISO-10303-21" not in stream.read(4096): raise ValueError("Catalog did not return a STEP file")
    except Exception:
        dest.unlink(missing_ok=True)
        raise
    from backend.services import cad_service
    cad_service.schedule_tessellate_step_to_glb(dest, dest.with_suffix(".glb"))
    catalog.save_profile(root, dest.stem, {"label": item["name"], "filename": dest.name, "confidence": "catalog",
        "stats": item.get("specs") or {}, "source": {"provider": "step.parts", "id": str(item["id"]),
        "step_url": item["step_url"], "page_url": item.get("catalog_url"),
        "product_page_url": item.get("purchase_url", item["url"]),
        "glb_url": item.get("glb_url"), "png_url": item.get("thumbnail_url"), "docs": item.get("docs") or []}})
    with parts._LOCK:
        data = parts.get_workspace(root)
        row = parts.clean_part({**item, "id": part_id, "model_filename": dest.name,
                                "url": item.get("purchase_url", item["url"])})
        previous = next((p for p in data["parts"] if p["id"] == part_id
                         or parts.purchase_url(p.get("url")) == parts.purchase_url(item["url"])), None)
        if previous:
            # Keep the shopping-list identity and bound mounts when enriching an
            # existing purchase with catalog geometry.
            row = merge_source_metadata(previous, row)
        elif row["url"] and parts.purchase_url(row["url"]) and len(data["parts"]) < parts.MAX_PARTS:
            data["parts"].append(row)
        parts._save(root, data)
    if not row["url"]:
        parts.save_questions(root, [{"id": part_id + ":purchase", "question": f"Where can {item['name']} be purchased?",
            "reason": "Catalog STEP and documentation saved in the part profile; no verified purchase URL was provided."}])
    return {"filename": dest.name, "source": row, "cached": False,
            "placement": "Inspect source units/dimensions, then mate into the complete assembly."}


def prompt_queries(prompt):
    """Small explicit component queries; never send a whole CAD brief as a search."""
    patterns = [r"raspberry\s+pi(?:\s+(?:zero\s*2?|[345]))?", r"arduino(?:\s+(?:nano|uno|mega|esp32))?",
                r"ESP32(?:[-\w]*)", r"NEMA\s*(?:17|23|34)", r"(?:motor|stepper)\s+driver",
                r"(?:DC[- /]?DC|buck)\s+converter", r"LiFePO4(?:\s+battery)?", r"CAN\s+(?:board|adapter|module)"]
    out = []
    for pattern in patterns:
        match = re.search(pattern, prompt or "", re.I)
        if match: out.append(match.group(0))
    if not out and re.search(r"\b(electronics|control board|robot(?:ic)? base)\b", prompt or "", re.I):
        out = ["motor driver", "control board"]
    return out[:3]


def improve_context(prompt):
    # Improve prepares a brief, not a generation. Do not eagerly run catalog
    # requests ahead of the required official-source lookup (or for tiny edits).
    queries = prompt_queries(prompt)
    if not queries: return ""
    return ("\n" + PARTS_SOURCING_RULES
            + ("\nSuggested exact-component catalog queries AFTER official lookup: " + json.dumps(queries) if queries else ""))
