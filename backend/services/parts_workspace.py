"""Project bill of materials, source-backed alternatives and approved edits."""
from __future__ import annotations

import hashlib
import json
import re
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse, parse_qs, urljoin

import httpx

from backend.services.purchase_parts import PURCHASE_LIST_RULES, purchase_url, unique_purchases

_LOCK = threading.RLock()
_THUMB_CACHE_LOCK = threading.RLock()
MAX_PARTS = 500
_THUMB_MISS_TTL = 24 * 3600
_HYDRATE_MAX = 12
_ADAFRUIT_PRODUCT = re.compile(r"/product/(\d+)", re.I)
_MCMASTER_PN = re.compile(r"^[0-9]{3,6}[A-Za-z][0-9A-Za-z]{1,8}$")
_VENDOR_LOGO = re.compile(
    r"mcmaster-carr(?:-masthead)?\.(?:svg|png)|/favicon|google\.com/s2/favicons",
    re.I,
)


def now():
    return datetime.now(timezone.utc).isoformat()


def safe_url(value):
    text = str(value or "").strip()[:2000]
    parsed = urlparse(text)
    return text if parsed.scheme == "https" and parsed.hostname and not parsed.username else ""


def mcmaster_part_number(part):
    pn = str(part.get("part_number") or "").strip().upper()
    if _MCMASTER_PN.fullmatch(pn):
        return pn
    href = purchase_url(part.get("url")) or safe_url(part.get("url"))
    host = (urlparse(href).hostname or "").lower()
    if "mcmaster.com" in host:
        seg = (urlparse(href).path or "").strip("/").split("/")[0].upper()
        if _MCMASTER_PN.fullmatch(seg):
            return seg
    return ""


def mcmaster_catalog_image(part):
    """McMaster part numbers do not map reliably to public image filenames."""
    return ""


def known_product_image(part):
    """Catalog photos already on the part or inferable from a vendor SKU/URL. No network."""
    existing = safe_url(part.get("thumbnail_url")) or safe_url(part.get("png_url")) or safe_url(part.get("image"))
    if existing and _VENDOR_LOGO.search(existing):
        existing = ""
    if existing:
        return existing
    href = purchase_url(part.get("url")) or safe_url(part.get("url"))
    host = (urlparse(href).hostname or "").lower()
    path = urlparse(href).path
    if host == "adafruit.com" or host.endswith(".adafruit.com"):
        match = _ADAFRUIT_PRODUCT.search(path)
        if match:
            return f"https://cdn-shop.adafruit.com/640x480/{match.group(1)}-00.jpg"
    return mcmaster_catalog_image(part)


def _thumb_cache_path(root):
    return Path(root) / "Parts List" / "thumbnails.json"


def _read_thumb_cache(root):
    path = _thumb_cache_path(root)
    try:
        data = json.loads(path.read_text())
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _write_thumb_cache(root, cache):
    path = _thumb_cache_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    items = list(cache.items())[-400:]
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(dict(items), ensure_ascii=False))
    temp.replace(path)


def _cached_thumb(entry):
    if isinstance(entry, str):
        return safe_url(entry), 0
    if not isinstance(entry, dict):
        return "", 0
    return safe_url(entry.get("thumbnail_url")), float(entry.get("at") or 0)


def decorate_workspace_thumbnails(root, data):
    """Attach inferred + previously cached photos without fetching vendor pages."""
    cache = _read_thumb_cache(root)

    def one(part):
        if not isinstance(part, dict):
            return part
        row = dict(part)
        image = known_product_image(row)
        if not image:
            image, _ = _cached_thumb(cache.get(purchase_url(row.get("url")) or ""))
        if image:
            row["thumbnail_url"] = image
        return row

    result = dict(data)
    result["parts"] = [one(p) for p in data.get("parts") or []]
    proposals = []
    for row in data.get("proposals") or []:
        item = dict(row)
        if isinstance(item.get("part"), dict):
            item["part"] = one(item["part"])
        if isinstance(item.get("before"), dict):
            item["before"] = one(item["before"])
        proposals.append(item)
    result["proposals"] = proposals
    return result


def hydrate_thumbnails(root, part_ids=None):
    """Fetch og:image for sourced products that still lack a photo. Cached by purchase URL."""
    wanted = {str(item) for item in (part_ids or [])[:40]}
    data = get_workspace(root)
    cache = _read_thumb_cache(root)
    now = time.time()
    thumbs = {}
    to_fetch, seen = [], set()
    for part in data.get("parts") or []:
        if wanted and str(part.get("id")) not in wanted:
            continue
        image = known_product_image(part)
        key = purchase_url(part.get("url"))
        if not image and key:
            image, fetched_at = _cached_thumb(cache.get(key))
            if not image and fetched_at and now - fetched_at < _THUMB_MISS_TTL:
                continue
            if not image and key not in seen:
                seen.add(key)
                to_fetch.append(part)
        if image:
            thumbs[str(part["id"])] = image
    to_fetch = to_fetch[:_HYDRATE_MAX]
    if to_fetch:
        from backend.services.link_preview import preview

        def lookup(part):
            try:
                return part, safe_url((preview(part["url"]) or {}).get("image"))
            except Exception:
                return part, ""

        with ThreadPoolExecutor(max_workers=4) as pool:
            fetched = list(pool.map(lookup, to_fetch))
        with _THUMB_CACHE_LOCK:
            cache = _read_thumb_cache(root)
            for part, image in fetched:
                key = purchase_url(part.get("url"))
                if not key:
                    continue
                cache[key] = {"thumbnail_url": image, "at": now}
                if image:
                    thumbs[str(part["id"])] = image
            try:
                _write_thumb_cache(root, cache)
            except OSError:
                pass
    return {"thumbnails": thumbs}


def clean_part(raw):
    row = {key: str(raw.get(key) or "")[:2000] for key in (
        "id", "name", "part_number", "description", "model_filename", "reason", "compatibility", "mount_changes", "replaces")}
    row["id"] = row["id"][:100] or uuid.uuid4().hex[:12]
    row["name"] = row["name"][:200] or row["part_number"] or "Unnamed component"
    category = str(raw.get("category") or "electronics").lower()
    row["category"] = "electronics" if category in {"electronics", "electronic", "wiring", "wire", "electrical"} else "mcmaster" if category == "mcmaster" else "mechanical"
    row["source_category"] = str(raw.get("source_category") or category)[:80]
    row["qty"] = max(1, min(9999, int(raw.get("qty") or 1)))
    for key in ("url", "thumbnail_url", "step_url", "glb_url", "catalog_url"):
        row[key] = safe_url(raw.get(key))
    if _VENDOR_LOGO.search(row["thumbnail_url"]):
        row["thumbnail_url"] = ""
    if not row["thumbnail_url"]:
        row["thumbnail_url"] = known_product_image({**row, "png_url": raw.get("png_url"), "image": raw.get("image")})
    for key in ("specs", "mounting"):
        value = raw.get(key) or {}
        row[key] = value if isinstance(value, dict) and len(json.dumps(value)) < 12000 else {}
    row["docs"] = [{"label": str(d.get("label") or "Datasheet")[:200], "url": safe_url(d.get("url"))}
                   for d in (raw.get("docs") or [])[:12] if isinstance(d, dict) and safe_url(d.get("url"))]
    row["provenance"] = {k: str((raw.get("provenance") or {}).get(k) or "")[:600]
                         for k in ("file", "status", "note", "catalog_id", "provider")}
    row["source_ids"] = list(dict.fromkeys([row["id"], *[str(x)[:100] for x in raw.get("source_ids", [])[:1000]]]))
    return row


def _path(root):
    return Path(root) / "Parts List" / "index.json"


def add_link(root, raw):
    """A user's Add to Parts List action; repeated clicks do not duplicate a part."""
    part = clean_part(raw)
    part["url"] = purchase_url(part["url"])
    if not part["url"]:
        raise ValueError("A direct HTTPS product link is required; documentation and unsourced parts are not purchase items")
    with _LOCK:
        data = get_workspace(root)
        if part["url"] in {purchase_url(url) for url in data.get("excluded_purchase_urls", [])}:
            raise ValueError("This link is a reference for this project, not a sourced purchase item")
        for existing in data["parts"]:
            if existing.get("url") == part["url"]:
                return {"part": existing, "added": False}
        if len(data["parts"]) >= MAX_PARTS:
            raise ValueError("Parts List is full (500 parts)")
        data["parts"].append(part)
        _save(root, data)
        return {"part": part, "added": True}


def _read(root):
    path = _path(root)
    if path.is_file():
        data = json.loads(path.read_text())
        if isinstance(data, dict):
            return data
    return {"schema": "render3d.parts/1", "revision": 0, "parts": [], "proposals": [], "changes": [], "questions": []}


def _save(root, data):
    data["parts"] = unique_purchases(data["parts"], excluded_urls=data.get("excluded_purchase_urls", []))
    path = _path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    data["updated_at"] = now()
    data["revision"] = int(data.get("revision", 0)) + 1
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, allow_nan=False, indent=2))
    temp.replace(path)
    (path.parent / "summary.json").write_text(json.dumps({"total": len(data["parts"]),
        "counts": {c: sum(p["category"] == c for p in data["parts"]) for c in ("electronics", "mcmaster", "mechanical")}}))
    for folder, category in (("Electronics", "electronics"), ("McMaster", "mcmaster"), ("Mechanical", "mechanical")):
        dest = path.parent / folder
        dest.mkdir(exist_ok=True)
        (dest / "parts.json").write_text(json.dumps({"parts": [p for p in data["parts"] if p["category"] == category]}, indent=2))


def reference_entries(root):
    """Cheap browser discovery: never source parts or parse CAD while opening a project."""
    base = Path(root) / "Parts List"
    if not (base / "index.json").is_file(): return []
    try:
        if not json.loads((base / "summary.json").read_text()).get("total"): return []
    except (OSError, ValueError):
        pass  # older workspaces are upgraded when the cart is opened
    return [{"id": "parts-list:" + category, "name": folder + " parts list.json", "label": folder + " parts list",
             "format": "json", "kind": "text", "folder": "Parts List/" + folder,
             "url": f"Parts List/{folder}/parts.json", "parts_tab": category}
            for folder, category in (("Electronics", "electronics"), ("McMaster", "mcmaster"), ("Mechanical", "mechanical"))
            if (base / folder / "parts.json").is_file()]


def _manifest_parts(root, data):
    """Migrate authoring manifests once per revision, including unfinished runs.

    A failed run still has useful proposed sources; it must never imply that its
    planned STEP files exist or that vendor specifications have been verified.
    """
    root = Path(root)
    stamps = data.setdefault("imports", {})
    rows, changed = [], False
    paths = sorted((root / "vibecad").glob("*.vibecad.json")) if (root / "vibecad").is_dir() else []
    for path in paths[:100]:
        st = path.stat()
        key = path.relative_to(root).as_posix()
        stem = path.name.removesuffix(".vibecad.json")
        published = any((path.parent / (stem + ext)).is_file() for ext in (".step", ".stp", ".glb"))
        stamp = f"v2:{st.st_mtime_ns}:{st.st_size}:{int(published)}"
        if stamps.get(key) == stamp or st.st_size > 20_000_000:
            continue
        try:
            payload = json.loads(path.read_text())
            listing = payload.get("parts_list") or {}
            items = listing.get("parts", []) if isinstance(listing, dict) else listing
            if not isinstance(items, list):
                continue
            for raw in items[:MAX_PARTS]:
                if not isinstance(raw, dict):
                    continue
                raw = dict(raw)
                raw["provenance"] = {"file": key, "status": "generated" if published else "draft",
                    "note": "Imported from CAD authoring metadata. Verify specifications against source documents." if published else "Recovered from an unfinished CAD run; geometry and specifications are unverified."}
                name = str(raw.get("model_filename") or "")
                candidate = (root / name).resolve()
                sibling = (path.parent / name).resolve()
                valid = next((p for p in (candidate, sibling) if p.is_relative_to(root.resolve()) and p.is_file()), None)
                raw["model_filename"] = valid.relative_to(root.resolve()).as_posix() if valid else ""
                rows.append(raw)
            if isinstance(listing, dict):
                questions = data.setdefault("questions", [])
                for q in listing.get("questions", [])[:40]:
                    if isinstance(q, str): q = {"question": q}
                    if not isinstance(q, dict) or not q.get("question"): continue
                    if any(x.get("question") == q["question"] for x in questions): continue
                    questions.append({"id": "import:" + hashlib.sha256(q["question"].encode()).hexdigest()[:12],
                                      "question": str(q["question"])[:3000], "reason": str(q.get("reason") or "")[:3000], "answer": ""})
                data["questions"] = questions[-80:]
            stamps[key] = stamp
            changed = True
        except (OSError, ValueError, TypeError, AttributeError):
            continue
    return rows, changed


def get_workspace(root):
    from backend.services import cad_service
    with _LOCK:
        data = _read(root)
        by_id = {p["id"]: p for p in unique_purchases(data["parts"], excluded_urls=data.get("excluded_purchase_urls", []))}
        replaced = {p.get("replaces") for p in data["parts"]}
        replaced.update((c.get("before") or {}).get("id") for c in data.get("changes", []))
        for change in data.get("changes", []):
            replaced.update((change.get("before") or {}).get("source_ids", []))
        current_urls = {purchase_url(p.get("url")) for p in by_id.values()}
        replaced_urls = {purchase_url((c.get("before") or {}).get("url")) for c in data.get("changes", [])} - current_urls
        imported = []
        manifest_rows, manifests_changed = _manifest_parts(root, data)
        # Authoring rows carry explicit quantities; generic library entries do not.
        imported.extend(manifest_rows)
        for raw in cad_service.parse_mcmaster_parts_rows(cad_service.read_mcmaster_parts_list(root)):
            imported.append({**raw, "id": "mc:" + raw["part_number"], "name": raw["description"], "category": "mcmaster", "url": raw.get("buy_url")})
        for raw in cad_service.list_mcmaster_library(root):
            imported.append({**raw, "id": "mc:" + (raw.get("part_number") or raw["filename"]), "name": raw.get("title") or raw["filename"], "category": "mcmaster", "url": raw.get("page_url"), "model_filename": raw.get("project_filename")})
        for name in ("parts_list.json", "electronics_parts.json"):
            path = Path(root) / name
            if path.is_file():
                try:
                    payload = json.loads(path.read_text())
                    rows = payload.get("parts", []) if isinstance(payload, dict) else payload
                    imported.extend({**row, "provenance":{**(row.get("provenance") or {}), "file":name}} for row in rows if isinstance(row, dict))
                    if isinstance(payload, dict):
                        for q in payload.get("questions", [])[:40]:
                            if isinstance(q, str): q = {"question": q}
                            if not isinstance(q, dict) or not q.get("question"): continue
                            questions = data.setdefault("questions", [])
                            if not any(x.get("question") == q["question"] for x in questions):
                                questions.append({"id":"electronics:" + hashlib.sha256(q["question"].encode()).hexdigest()[:12], "question":str(q["question"])[:3000], "reason":str(q.get("reason") or "")[:3000], "answer":""})
                                manifests_changed = True
                except (ValueError, TypeError):
                    pass
        wiring = Path(root) / "wiring.json"
        if wiring.is_file():
            try:
                schematic = json.loads(wiring.read_text())
                grouped = {}
                for item in schematic.get("components", []):
                    url = purchase_url(item.get("source_url"))
                    if not url: continue
                    row = grouped.setdefault(url, {"id": "wiring:" + hashlib.sha256(url.encode()).hexdigest()[:12],
                        "name": item.get("label") or item.get("type") or "Electronic component",
                        "category": "electronics", "qty": 0, "url": url, "specs": item.get("params") or {}, "docs": [],
                        "provenance": {"file":"wiring.json", "status":"generated", "note":"Schematic component; verify ratings against linked documents."}})
                    row["qty"] += max(1, min(9999, int(item.get("qty") or 1)))
                    row["docs"].extend(d for d in item.get("docs", []) if isinstance(d, dict))
                imported.extend(grouped.values())
            except (ValueError, TypeError):
                pass
        for raw in imported[:MAX_PARTS]:
            if not isinstance(raw, dict):
                continue
            url = purchase_url(raw.get("url"))
            if not url or url in replaced_urls:
                continue
            if not raw.get("id"):
                raw["id"] = "part:" + hashlib.sha256(str(raw.get("part_number") or raw.get("name") or raw).encode()).hexdigest()[:12]
            existing = by_id.get(raw["id"])
            refresh_import = existing and raw.get("provenance", {}).get("file") and not existing.get("replaces") and (
                not existing.get("provenance", {}).get("file") or existing["provenance"]["file"] == raw["provenance"]["file"])
            if (not existing or refresh_import) and raw["id"] not in replaced and len(by_id) < MAX_PARTS:
                try:
                    row = clean_part(raw)
                    if existing and not row.get("model_filename"):
                        row["model_filename"] = existing.get("model_filename") or ""
                    if existing and existing.get("mounting", {}).get("edit_target"):
                        row["mounting"]["edit_target"] = existing["mounting"]["edit_target"]
                    by_id[row["id"]] = row
                except (TypeError, ValueError):
                    continue
        purchases = unique_purchases(by_id.values(), excluded_urls=data.get("excluded_purchase_urls", []))
        if manifests_changed or purchases != data["parts"] or not _path(root).exists():
            data["parts"] = purchases
            _save(root, data)
        return data


def save_questions(root, questions):
    with _LOCK:
        data = get_workspace(root)
        existing = {q["id"]: q for q in data.get("questions", [])}
        for raw in questions[:40]:
            if not isinstance(raw, dict):
                continue
            if not raw.get("id"):
                duplicate = next((q for q in existing.values() if q.get("question", "").casefold() == str(raw.get("question", "")).casefold()), None)
                if duplicate:
                    raw = {**raw, "id": duplicate["id"]}
            qid = str(raw.get("id") or uuid.uuid4().hex[:12])[:100]
            row = existing.get(qid, {"id": qid})
            for key in ("question", "answer", "reason"):
                if key in raw:
                    row[key] = str(raw[key] or "")[:3000]
            existing[qid] = row
        data["questions"] = list(existing.values())[-80:]
        _save(root, data)
        return data


def store_proposals(root, suggestions):
    with _LOCK:
        data = get_workspace(root)
        ids = {p["id"] for p in data["parts"]}
        rows = []
        for item in suggestions[:12]:
            target = str(item.get("replaces") or "")
            if target and target not in ids:
                continue
            part = clean_part(item)
            part["url"] = purchase_url(part["url"])
            if not part["url"] or part["url"] in {purchase_url(url) for url in data.get("excluded_purchase_urls", [])}:
                continue
            rows.append({"id": uuid.uuid4().hex, "status": "pending", "part": part, "created_at": now(),
                         "before": next((p for p in data["parts"] if p["id"] == target), None)})
        data["proposals"] = [*data.get("proposals", []), *rows][-60:]
        _save(root, data)
        return data


def decide(root, proposal_id, approve):
    with _LOCK:
        data = get_workspace(root)
        row = next((p for p in data["proposals"] if p["id"] == proposal_id), None)
        if not row:
            raise ValueError("Proposal no longer exists")
        if row["status"] != "pending":
            return data
        if approve:
            if not purchase_url(row["part"].get("url")) or purchase_url(row["part"].get("url")) in {
                purchase_url(url) for url in data.get("excluded_purchase_urls", [])
            }:
                raise ValueError("Source a direct product purchase link before approving this part")
            target = row["part"].get("replaces")
            current = next((p for p in data["parts"] if p["id"] == target), None)
            if target and current != row["before"]:
                raise ValueError("The original part changed. Ask for fresh alternatives before replacing it.")
            if not target and len(data["parts"]) >= MAX_PARTS:
                raise ValueError("The parts list is full")
            data["parts"] = [p for p in data["parts"] if p["id"] != target]
            replacement = {**row["part"], "id": uuid.uuid4().hex[:12]}
            data["parts"].append(replacement)
            data["changes"].append({"id": row["id"], "before": current, "after": replacement, "at": now()})
            data["changes"] = data["changes"][-100:]
        row["status"] = "approved" if approve else "denied"
        _save(root, data)
        return data


def edit_brief(data):
    lines = ["Update the selected assembly for these approved Parts List changes. Preserve unrelated geometry, materials and joints."]
    for change in data.get("changes", [])[-20:]:
        old, new = change.get("before") or {}, change["after"]
        lines.append(f"- Replace {old.get('name', 'empty position')} with {new['name']}: {new.get('url', '')}.")
        lines.append("  Required mounting/wiring changes: " + (new.get("mount_changes") or "Inspect the confirmed footprint, connector clearances and cable path."))
        lines.append("  Confirmed mounting data: " + json.dumps(new.get("mounting") or {}))
    lines.append("Use the linked selected models, faces, edges and vertices as edit targets. Do not invent vertex IDs or mounting-hole dimensions. Ask follow-up questions for missing specifications before changing mounts.")
    return "\n".join(lines)


class _SearchParser(HTMLParser):
    def __init__(self):
        super().__init__(); self.rows = []; self.current = None
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "a" and "result__a" in attrs.get("class", ""):
            url = attrs.get("href", "")
            url = parse_qs(urlparse(url).query).get("uddg", [url])[0]
            self.current = {"title": "", "url": safe_url(url)}
    def handle_data(self, data):
        if self.current is not None:
            self.current["title"] += data
    def handle_endtag(self, tag):
        if tag == "a" and self.current is not None:
            if self.current["url"]:
                self.rows.append(self.current)
            self.current = None


def search_parts(query):
    response = httpx.get("https://html.duckduckgo.com/html/", params={"q": str(query)[:500] + " product datasheet"},
                         headers={"User-Agent": "Mozilla/5.0"}, timeout=20)
    response.raise_for_status()
    parser = _SearchParser(); parser.feed(response.text[:1_000_000])
    rows = parser.rows[:10]
    if not rows:
        raise ValueError("Web search is temporarily unavailable. No unverified alternatives were added. Try again later.")
    return rows


_PRODUCT_DOMAINS = {"pololu.com", "adafruit.com", "raspberrypi.com", "waveshare.com", "robotshop.com",
    "digikey.com", "mouser.com", "mcmaster.com", "dimensionengineering.com", "wattcycle.com",
    "litime.com", "sparkfun.com", "dfrobot.com", "seeedstudio.com", "basicmicro.com"}


class _ProductParser(HTMLParser):
    def __init__(self, base):
        super().__init__(); self.base = base; self.thumbnail = ""; self.text = []; self.skip = 0; self.docs = []
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in {"script", "style", "nav"}:
            self.skip += 1
        if tag == "meta" and attrs.get("property", attrs.get("name")) in {"og:image", "twitter:image"}:
            self.thumbnail = safe_url(urljoin(self.base, attrs.get("content", "")))
        if tag == "a" and ".pdf" in attrs.get("href", "").lower():
            link = safe_url(urljoin(self.base, attrs["href"]))
            if link and not any(d["url"] == link for d in self.docs):
                self.docs.append({"label": "Manufacturer PDF", "url": link})
    def handle_endtag(self, tag):
        if tag in {"script", "style", "nav"}:
            self.skip = max(0, self.skip - 1)
    def handle_data(self, value):
        if not self.skip and value.strip():
            self.text.append(value.strip())


def enrich_source(source):
    """Read product metadata only on a fixed set of public supplier domains.

    Redirects are validated at each hop; user/AI URLs cannot address LAN services.
    """
    result = dict(source)
    current = source["url"]
    for _ in range(4):
        host = (urlparse(current).hostname or "").lower()
        if not any(host == domain or host.endswith("." + domain) for domain in _PRODUCT_DOMAINS):
            return result
        try:
            with httpx.stream("GET", current, timeout=8, follow_redirects=False, headers={"User-Agent": "Mozilla/5.0"}) as response:
                if response.is_redirect:
                    current = safe_url(urljoin(current, response.headers.get("location", "")))
                    continue
                response.raise_for_status()
                chunks = bytearray()
                for chunk in response.iter_bytes():
                    chunks.extend(chunk)
                    if len(chunks) >= 400000:
                        break
            parser = _ProductParser(current); parser.feed(chunks.decode("utf-8", errors="replace"))
            return {**result, "thumbnail_url": parser.thumbnail, "excerpt": " ".join(parser.text)[:9000], "docs": parser.docs[:8]}
        except httpx.HTTPError:
            return result
    return result


def context_text(root):
    data = get_workspace(root)
    return PURCHASE_LIST_RULES + "\nParts List and answered requirements:\n" + json.dumps({
        "parts": data["parts"], "changes": data["changes"][-10:], "questions": data["questions"],
    }, ensure_ascii=False)[:45000]
