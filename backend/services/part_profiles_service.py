"""Per-project electronic part profiles.

Each CAD component (a STEP/GLB file in a project) can carry a *part profile*:
the recognized electronic identity (wiring type + kind), human label, free-form
statistics, and an optional link to an online source (step.parts) including a
canonical STEP reference, preview image, and GLB for 3D viewing.

Profiles are stored in ``projects/{id}/part_profiles.json`` keyed by file stem.
The wiring simulator reads these so it knows *for sure* which electrical part a
dragged component is, and renders a nicer preview from the sourced assets.
"""

from __future__ import annotations

import json
import logging
import os
import re
from urllib.parse import quote_plus
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger(__name__)

PROFILE_FILE = "part_profiles.json"
STEP_PARTS_ORIGIN = "https://api.step.parts"

CATALOG_SOURCE_OPTIONS: list[dict[str, Any]] = [
    {"id": "step_parts", "label": "step.parts", "kind": "cad", "importable": True, "enabled": True},
    {"id": "octopart", "label": "Octopart / Nexar", "kind": "spec_price", "importable": False, "enabled": True},
    {"id": "digikey", "label": "Digi-Key", "kind": "supplier", "importable": False, "enabled": True},
    {"id": "mouser", "label": "Mouser", "kind": "supplier", "importable": False, "enabled": True},
    {"id": "snapeda", "label": "SnapEDA", "kind": "eda_cad", "importable": False, "enabled": True},
    {"id": "ultralibrarian", "label": "Ultra Librarian", "kind": "eda_cad", "importable": False, "enabled": True},
    {"id": "traceparts", "label": "TraceParts", "kind": "mechanical_cad", "importable": False, "enabled": True},
    {"id": "3dfindit", "label": "3Dfindit / CADENAS", "kind": "mechanical_cad", "importable": False, "enabled": True},
    {"id": "amazon", "label": "Amazon", "kind": "marketplace", "importable": False, "enabled": True},
    {"id": "alibaba", "label": "Alibaba", "kind": "marketplace", "importable": False, "enabled": True},
    {"id": "mcmaster", "label": "McMaster-Carr", "kind": "mechanical_supplier", "importable": False, "enabled": True},
]

API_REQUIRED_SOURCES = {
    "octopart": ("NEXAR_CLIENT_ID", "NEXAR_CLIENT_SECRET"),
    "digikey": ("DIGIKEY_CLIENT_ID", "DIGIKEY_CLIENT_SECRET"),
    "mouser": ("MOUSER_API_KEY",),
}

# Wiring-simulator component types we can map a recognized part to.
WIRING_TYPES = {
    "raspberry-pi", "arduino-uno", "arduino-mega", "breadboard", "servo-motor",
    "motor-driver", "stepper", "led", "resistor", "transistor", "diode",
    "button", "sensor", "motor",
}

# Mechanical shells / fixtures — never auto-assign an electrical pin type.
_ENCLOSURE_RE = re.compile(
    r"\b(case|enclosure|housing|lid|cover|shell|chassis|bracket|holder|stand|bezel|faceplate)\b"
)

# Ordered (most specific first) recognition rules: regex -> (wiring_type, kind, datasheet hint)
_RULES: list[tuple[re.Pattern[str], str, str, str]] = [
    (re.compile(r"28byj|stepper|nema\s*\d|nema\d"), "stepper", "Stepper motor", "stepper coil pinout (28BYJ-48 / NEMA) datasheet"),
    (re.compile(r"servo|sg90|mg996|mg90"), "servo-motor", "Servo motor", "servo signal/VCC/GND pinout"),
    (re.compile(r"l298|l293|uln2003|a4988|drv8825|tb6600|tb6612|motor[_\- ]?driver|h[_\- ]?bridge|stepper[_\- ]?driver"), "motor-driver", "Motor driver", "driver IN/OUT + VCC/GND pinout"),
    (re.compile(r"dc[_\- ]?motor|gear[_\- ]?motor|\bmotor\b|tt[_\- ]?motor|brushed"), "motor", "DC motor", "DC motor terminal polarity"),
    (re.compile(r"arduino[_\- ]?mega|atmega2560|\bmega\b"), "arduino-mega", "Arduino Mega", "Arduino Mega 2560 pinout"),
    (re.compile(r"arduino|atmega|\bnano\b|\buno\b|leonardo|pro[_\- ]?micro|atmega328|seeeduino"), "arduino-uno", "Arduino board", "Arduino pinout (D-pins, A-pins, 5V, GND)"),
    (re.compile(r"raspberry|\brpi\b|\bpi[_\- ]?(zero|3|4|5|pico)\b|bcm283|rp2040"), "raspberry-pi", "Raspberry Pi", "Raspberry Pi 40-pin GPIO header"),
    (re.compile(r"2n2222|bc547|bc548|tip120|mosfet|irf\d|irlz|npn|pnp|transistor"), "transistor", "Transistor", "base/collector/emitter pinout"),
    (re.compile(r"1n4148|1n400\d|schottky|flyback|\bdiode\b"), "diode", "Diode", "anode/cathode (band = cathode)"),
    # Avoid bare "5R" / "UV-5R" style model codes — require resistor / ohm wording.
    (re.compile(r"resistor|\b\d+(\.\d+)?\s*k?\s*ohms?\b|\bohm\b"), "resistor", "Resistor", "resistor value / colour code"),
    (re.compile(r"\bled\b|neopixel|ws2812|diffused|5mm[_\- ]?led"), "led", "LED", "LED forward voltage + anode/cathode"),
    (re.compile(r"button|push[_\- ]?button|tactile|momentary|switch|\bspst\b"), "button", "Push button", "switch contact pinout"),
    (re.compile(r"sensor|hc[_\- ]?sr04|ultrasonic|\bpir\b|\bdht\d{2}\b|photo|ldr|potentiometer|\bpot\b|encoder|hall|imu|mpu6050"), "sensor", "Sensor / input module", "sensor module pinout"),
    (re.compile(r"breadboard|protoboard|perfboard"), "breadboard", "Breadboard", "breadboard rail / column connectivity"),
]


def _path(project_path: Path) -> Path:
    return project_path / PROFILE_FILE


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize(name: str) -> str:
    return re.sub(r"[_\-]+", " ", re.sub(r"\.[^.]+$", "", name or "")).lower().strip()


def recognize(name: str) -> dict[str, Any] | None:
    """Heuristic recognition from a file name. Returns None when nothing matches.

    Cases / enclosures / lids never auto-map to an electrical pin type — those are
    mechanical CAD parts even when the name mentions ESP32, Arduino, etc.
    """
    norm = _normalize(name)
    if not norm:
        return None
    if _ENCLOSURE_RE.search(norm):
        return None
    for pattern, wiring_type, kind, datasheet in _RULES:
        if pattern.search(norm):
            return {"wiring_type": wiring_type, "kind": kind, "datasheet": datasheet}
    return None


def _pretty_label(name: str) -> str:
    norm = _normalize(name)
    return " ".join(w.upper() if w[:1].isdigit() else w.capitalize() for w in norm.split() if w)


def load_all(project_path: Path) -> dict[str, Any]:
    path = _path(project_path)
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data.get("profiles", {}) if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def save_all(project_path: Path, profiles: dict[str, Any]) -> None:
    try:
        _path(project_path).write_text(
            json.dumps({"profiles": profiles, "updated_at": _now()}, indent=2),
            encoding="utf-8",
        )
    except OSError as exc:  # pragma: no cover
        logger.warning("could not save part profiles: %s", exc)


def seed_profile(stem: str, filename: str | None = None) -> dict[str, Any]:
    """Create a blank profile for a generated/imported CAD part.

    Electrical type stays unset (none) until the user explicitly picks one in the
    component profile UI — filename heuristics must not auto-assign pins.
    """
    rec = recognize(stem)
    profile: dict[str, Any] = {
        "stem": stem,
        "filename": filename or stem,
        "label": _pretty_label(stem) or stem,
        # Always default Electrical type (pins) to none for newly generated models.
        "wiring_type": None,
        "kind": rec["kind"] if rec else "Unrecognized part",
        "datasheet": rec["datasheet"] if rec else None,
        "confidence": "low",
        "stats": {},
        "source": None,
        "updated_at": _now(),
    }
    return profile


def _should_clear_auto_wiring(profile: dict[str, Any], stem: str) -> bool:
    """Drop auto-guessed pin types (esp. enclosures) that were never user-confirmed."""
    wiring = profile.get("wiring_type")
    if not wiring:
        return False
    if profile.get("confidence") == "user" or profile.get("source"):
        return False
    if _ENCLOSURE_RE.search(_normalize(stem)) or _ENCLOSURE_RE.search(_normalize(profile.get("label") or "")):
        return True
    # Legacy auto-seeds used confidence "high" from filename recognition.
    return profile.get("confidence") == "high"


def get_or_seed(project_path: Path, stem: str, filename: str | None = None) -> dict[str, Any]:
    profiles = load_all(project_path)
    if stem in profiles:
        current = profiles[stem]
        if _should_clear_auto_wiring(current, stem):
            current = {**current, "wiring_type": None, "confidence": "low", "updated_at": _now()}
            profiles[stem] = current
            save_all(project_path, profiles)
        return current
    profile = seed_profile(stem, filename)
    profiles[stem] = profile
    save_all(project_path, profiles)
    return profile


def save_profile(project_path: Path, stem: str, patch: dict[str, Any]) -> dict[str, Any]:
    profiles = load_all(project_path)
    current = profiles.get(stem) or seed_profile(stem, patch.get("filename"))
    allowed = {"label", "wiring_type", "kind", "datasheet", "confidence", "stats", "source", "notes", "filename"}
    for key, value in patch.items():
        if key in allowed:
            current[key] = value
    # Explicit clear: empty string / null means "none".
    if "wiring_type" in patch:
        wt = patch.get("wiring_type")
        if not wt or wt not in WIRING_TYPES:
            current["wiring_type"] = None
        else:
            current["wiring_type"] = wt
    current["stem"] = stem
    current["updated_at"] = _now()
    profiles[stem] = current
    save_all(project_path, profiles)
    return current


def _map_source_to_wiring_type(item: dict[str, Any]) -> str | None:
    blob = " ".join(
        str(item.get(k) or "")
        for k in ("name", "description", "category", "family")
    ) + " " + " ".join(str(t) for t in (item.get("tags") or []))
    rec = recognize(blob)
    return rec["wiring_type"] if rec else None


def _clean_search_query(query: str) -> str:
    text = _normalize(query)
    text = re.sub(r"\b(edited|edit|copy|copied|part|body|model|glb|step|stl|obj)\b", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _query_variants(query: str) -> list[str]:
    cleaned = _clean_search_query(query)
    variants = [query, cleaned]
    rec = recognize(cleaned or query)
    if rec:
        kind = str(rec.get("kind") or "")
        if "Arduino" in kind:
            variants.extend(["arduino nano", "arduino", "nano microcontroller board"])
        elif "Stepper" in kind:
            variants.extend(["stepper motor", "nema stepper", "28byj stepper"])
        elif "Raspberry" in kind:
            variants.extend(["raspberry pi", "raspberry pi board"])
        elif "Motor driver" in kind:
            variants.extend(["motor driver", "stepper driver"])
    out: list[str] = []
    seen: set[str] = set()
    for item in variants:
        value = " ".join(str(item or "").split())
        key = value.lower()
        if value and key not in seen:
            seen.add(key)
            out.append(value)
    return out


def _builtin_candidates(query: str, limit: int) -> list[dict[str, Any]]:
    rec = recognize(query)
    if not rec:
        return []
    norm = _clean_search_query(query)
    candidates: list[dict[str, Any]] = []
    if rec["wiring_type"] == "arduino-uno":
        name = "Arduino Nano compatible board" if "nano" in norm else "Arduino compatible board"
        candidates.append({
            "provider": "built-in",
            "id": "arduino-nano-compatible" if "nano" in norm else "arduino-compatible",
            "name": name,
            "description": "Recognized locally from the part name; online STEP catalog did not return an exact match.",
            "category": "Microcontroller board",
            "family": "Arduino",
            "tags": ["arduino", "nano", "microcontroller"],
            "attributes": {
                "length_mm": 45.0 if "nano" in norm else 68.6,
                "width_mm": 18.0 if "nano" in norm else 53.4,
                "logic_voltage": "5V / 3.3V varies by board",
                "pins": "Digital, analog, 5V, GND",
            },
            "page_url": None,
            "step_url": None,
            "glb_url": None,
            "png_url": None,
            "wiring_type": "arduino-uno",
        })
    elif rec["wiring_type"] == "stepper":
        candidates.append({
            "provider": "built-in",
            "id": "generic-stepper-motor",
            "name": "Generic stepper motor",
            "description": "Recognized locally from the part name; online STEP catalog did not return an exact match.",
            "category": "Motor",
            "family": "Stepper",
            "tags": ["stepper", "motor"],
            "attributes": {"pins": "Coil A+/A-/B+/B-", "type": "bipolar/unipolar stepper"},
            "page_url": None,
            "step_url": None,
            "glb_url": None,
            "png_url": None,
            "wiring_type": "stepper",
        })
    return candidates[:limit]


def price_search_links(query: str) -> list[dict[str, str]]:
    """Supplier/spec search links for price comparison without marketplace scraping."""
    q = quote_plus(_clean_search_query(query) or query)
    return [
        {"provider": "Amazon", "url": f"https://www.amazon.com/s?k={q}"},
        {"provider": "Alibaba", "url": f"https://www.alibaba.com/trade/search?SearchText={q}"},
        {"provider": "Digi-Key", "url": f"https://www.digikey.com/en/products/result?keywords={q}"},
        {"provider": "Mouser", "url": f"https://www.mouser.com/c/?q={q}"},
        {"provider": "Octopart", "url": f"https://octopart.com/search?q={q}"},
        {"provider": "Spec sheet", "url": f"https://www.google.com/search?q={q}+datasheet+pdf"},
    ]


def catalog_source_options() -> list[dict[str, Any]]:
    return [{**item, **_source_status(item["id"])} for item in CATALOG_SOURCE_OPTIONS]


def _source_status(source: str) -> dict[str, Any]:
    required = API_REQUIRED_SOURCES.get(source)
    if not required:
        return {"configured": True, "retrieval_mode": "live" if source == "step_parts" else "external_link"}
    configured = all(os.getenv(name) for name in required)
    return {
        "configured": configured,
        "requires": list(required),
        "retrieval_mode": "api" if configured else "external_link",
        "note": None if configured else f"Set {', '.join(required)} for live {source} results.",
    }


def _selected_catalog_sources(sources: list[str] | None) -> list[str]:
    valid = {item["id"] for item in CATALOG_SOURCE_OPTIONS}
    selected = [str(s).strip() for s in (sources or []) if str(s).strip() in valid]
    return selected or [item["id"] for item in CATALOG_SOURCE_OPTIONS if item["enabled"]]


def _source_url(source: str, query: str) -> str:
    q = quote_plus(_clean_search_query(query) or query)
    urls = {
        "octopart": f"https://octopart.com/search?q={q}",
        "digikey": f"https://www.digikey.com/en/products/result?keywords={q}",
        "mouser": f"https://www.mouser.com/c/?q={q}",
        "snapeda": f"https://www.snapeda.com/search/?q={q}",
        "ultralibrarian": f"https://app.ultralibrarian.com/search?query={q}",
        "traceparts": f"https://www.traceparts.com/en/search?q={q}",
        "3dfindit": f"https://www.3dfindit.com/en/search?q={q}",
        "amazon": f"https://www.amazon.com/s?k={q}",
        "alibaba": f"https://www.alibaba.com/trade/search?SearchText={q}",
        "mcmaster": f"https://www.mcmaster.com/products/{q}/",
    }
    return urls.get(source, f"https://www.google.com/search?q={q}")


def _source_description(source: str) -> str:
    descriptions = {
        "octopart": "Electronic part specs, datasheets, lifecycle, stock, and distributor price comparison.",
        "digikey": "Digi-Key supplier catalog with datasheets, stock, parametric specs, and pricing.",
        "mouser": "Mouser supplier catalog with datasheets, stock, parametric specs, and pricing.",
        "snapeda": "Symbols, footprints, 3D/EDA models, and datasheets for electronic components.",
        "ultralibrarian": "Electronic CAD models, symbols, footprints, and datasheets.",
        "traceparts": "Large manufacturer CAD library for mechanical, electrical, and industrial parts.",
        "3dfindit": "CADENAS 3Dfindit manufacturer CAD models and industrial part metadata.",
        "amazon": "Marketplace search for price checking and fast purchase options.",
        "alibaba": "Marketplace search for bulk/low-cost sourcing and supplier comparison.",
        "mcmaster": "Mechanical hardware catalog with CAD models, specs, and purchasing.",
    }
    return descriptions.get(source, "External catalog search.")


def _external_source_candidate(source: str, query: str) -> dict[str, Any]:
    option = next((item for item in CATALOG_SOURCE_OPTIONS if item["id"] == source), {"label": source, "kind": "catalog"})
    status = _source_status(source)
    page_url = _source_url(source, query)
    configured = bool(status.get("configured"))
    title_prefix = "Search" if status.get("retrieval_mode") == "external_link" else "Query"
    return {
        "provider": option["label"],
        "provider_id": source,
        "id": f"{source}:{_clean_search_query(query) or query}",
        "name": f"{title_prefix} {option['label']} for \"{_clean_search_query(query) or query}\"",
        "description": (
            _source_description(source)
            if configured or source not in API_REQUIRED_SOURCES
            else f"{_source_description(source)} Live retrieval needs API credentials; this opens the provider search page."
        ),
        "category": option.get("kind"),
        "family": None,
        "tags": [source, option.get("kind")],
        "attributes": {},
        "page_url": page_url,
        "step_url": None,
        "glb_url": None,
        "png_url": None,
        "datasheet_url": f"https://www.google.com/search?q={quote_plus((_clean_search_query(query) or query) + ' datasheet pdf')}",
        "price_links": price_search_links(query),
        "wiring_type": recognize(query).get("wiring_type") if recognize(query) else None,
        "source_kind": option.get("kind"),
        "source_label": option["label"],
        "retrieval_mode": status.get("retrieval_mode"),
        "source_note": status.get("note"),
        "is_real_result": False,
        "importable": False,
    }


def _product_page_url(item: dict[str, Any]) -> str | None:
    attrs = item.get("attributes") or {}
    candidates = [
        item.get("productPage"),
        item.get("productPageUrl"),
        item.get("productUrl"),
        item.get("product_url"),
        attrs.get("productPage"),
        attrs.get("productPageUrl"),
        attrs.get("product_url"),
        attrs.get("Product Page"),
        attrs.get("product page"),
    ]
    for value in candidates:
        if isinstance(value, str) and value.startswith(("http://", "https://")):
            return value
    blob = " ".join(str(item.get(k) or "") for k in ("id", "name", "model", "sku")).lower()
    if "arduino_nano_r4" in blob or ("arduino" in blob and "nano" in blob and "r4" in blob):
        return "https://docs.arduino.cc/hardware/nano-r4/"
    return None


def search_catalog(query: str, *, sources: list[str] | None = None, limit: int = 12) -> dict[str, Any]:
    selected = _selected_catalog_sources(sources)
    candidates: list[dict[str, Any]] = []
    errors: dict[str, str] = {}
    if "step_parts" in selected:
        try:
            step_limit = limit if selected == ["step_parts"] else min(8, max(3, limit // 2))
            for item in search_sources(query, limit=step_limit):
                item["provider_id"] = "step_parts"
                item["source_kind"] = "cad"
                item["source_label"] = "step.parts" if item.get("provider") == "step.parts" else "built-in fallback"
                item["retrieval_mode"] = "live" if item.get("provider") == "step.parts" else "local_fallback"
                item["is_real_result"] = item.get("provider") == "step.parts"
                item["importable"] = bool(item.get("step_url"))
                item.setdefault("price_links", price_search_links(query))
                item.setdefault("datasheet_url", item.get("page_url"))
                item.setdefault("product_page_url", item.get("product_page_url"))
                candidates.append(item)
        except RuntimeError as exc:
            errors["step_parts"] = str(exc)
    for source in selected:
        if source == "step_parts":
            continue
        candidates.append(_external_source_candidate(source, query))
    return {
        "query": query,
        "sources": catalog_source_options(),
        "selected_sources": selected,
        "candidates": candidates,
        "price_links": price_search_links(query),
        "errors": errors,
    }


def search_sources(query: str, *, limit: int = 8, origin: str = STEP_PARTS_ORIGIN) -> list[dict[str, Any]]:
    """Search the step.parts catalog. Returns simplified candidate records.

    Raises RuntimeError when the catalog is unreachable so the caller can report it.
    """
    url = f"{origin}/v1/parts"
    items: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    last_exc: Exception | None = None
    for q in _query_variants(query):
        try:
            resp = httpx.get(url, params={"q": q, "pageSize": min(max(limit, 1), 50)}, timeout=12.0)
            resp.raise_for_status()
            data = resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            last_exc = exc
            continue
        for item in data.get("items") or []:
            key = str(item.get("id") or item.get("name") or "")
            if key and key in seen_ids:
                continue
            if key:
                seen_ids.add(key)
            items.append(item)
            if len(items) >= limit:
                break
        if len(items) >= limit:
            break
    out: list[dict[str, Any]] = []
    for item in items[:limit]:
        out.append(
            {
                "provider": "step.parts",
                "provider_id": "step_parts",
                "source_label": "step.parts",
                "retrieval_mode": "live",
                "is_real_result": True,
                "id": item.get("id"),
                "name": item.get("name"),
                "description": item.get("description"),
                "category": item.get("category"),
                "family": item.get("family"),
                "tags": item.get("tags") or [],
                "attributes": item.get("attributes") or {},
                "page_url": item.get("pageUrl"),
                "product_page_url": _product_page_url(item),
                "step_url": item.get("stepUrl"),
                "glb_url": item.get("glbUrl"),
                "png_url": item.get("pngUrl"),
                "wiring_type": _map_source_to_wiring_type(item),
            }
        )
    if not out:
        out.extend(_builtin_candidates(query, limit))
    if not out and last_exc is not None:
        raise RuntimeError(f"Could not reach the parts catalog: {last_exc}") from last_exc
    return out


def download_asset(url: str, dest: Path, *, timeout: float = 60.0) -> None:
    """Stream a remote asset (e.g. a STEP file) to a local path."""
    try:
        with httpx.stream("GET", url, timeout=timeout, follow_redirects=True) as resp:
            resp.raise_for_status()
            with dest.open("wb") as fh:
                for chunk in resp.iter_bytes():
                    fh.write(chunk)
    except httpx.HTTPError as exc:
        raise RuntimeError(f"Could not download part asset: {exc}") from exc


def link_source(project_path: Path, stem: str, candidate: dict[str, Any]) -> dict[str, Any]:
    """Attach a chosen catalog candidate to a profile, merging stats + identity."""
    profiles = load_all(project_path)
    current = profiles.get(stem) or seed_profile(stem)
    source = {
        "provider": candidate.get("provider") or "step.parts",
        "id": candidate.get("id"),
        "name": candidate.get("name"),
        "page_url": candidate.get("page_url"),
        "product_page_url": candidate.get("product_page_url"),
        "step_url": candidate.get("step_url"),
        "glb_url": candidate.get("glb_url"),
        "png_url": candidate.get("png_url"),
        "category": candidate.get("category"),
        "family": candidate.get("family"),
        "attributes": candidate.get("attributes") or {},
    }
    current["source"] = source
    # Merge catalog attributes into stats (don't clobber user-entered stats).
    stats = dict(current.get("stats") or {})
    for key, value in (candidate.get("attributes") or {}).items():
        stats.setdefault(str(key), value)
    current["stats"] = stats
    if candidate.get("name"):
        current["label"] = candidate["name"]
    wt = candidate.get("wiring_type") or _map_source_to_wiring_type(candidate)
    if wt and wt in WIRING_TYPES:
        current["wiring_type"] = wt
        current["confidence"] = "user"
    current["stem"] = stem
    current["updated_at"] = _now()
    profiles[stem] = current
    save_all(project_path, profiles)
    return current
