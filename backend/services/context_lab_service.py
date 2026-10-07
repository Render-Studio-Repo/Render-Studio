"""Context Lab: machine profiles, Improve settings, notes, custom Improve, Improve Lab."""

from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from html import unescape
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urlparse

import httpx

from backend.config import settings
from backend.database import get_conn

logger = logging.getLogger("render3d.context_lab")

GOOGLE_DRIVE_SCOPES = (
    "openid email profile "
    "https://www.googleapis.com/auth/drive.readonly"
)

IMPROVE_LAB_DIRNAME = "Improve Lab"
EXAMPLE_PROMPTS = [
    "create a enclosure and mount for a",
    "print-in-place box with a living hinge lid",
    "phone stand with a cable clip and rubber feet",
    "sheet-metal bracket for a 40mm fan",
    "CNC fixture plate for a 100mm cube blank",
    "laser-cut acrylic faceplate with standoffs",
    "simple two-part snap-fit battery door",
    "desk clamp that holds a 12mm rod",
]

# Cover PNGs vendored from Orca Slicer (AGPL-3.0, https://github.com/SoftFever/OrcaSlicer)
# resources/profiles/{BBL,Prusa,Creality,Voron}/*_cover.png — data assets, not the slicer binary.
ORCA_COVER_IDS = {
    "prusa-mk4",
    "prusa-mini",
    "prusa-xl",
    "bambu-x1c",
    "bambu-p1s",
    "bambu-a1",
    "bambu-a1-mini",
    "ender-3-v3",
    "voron-24",
}

PRINTER_KINDS = frozenset({"fdm_printer", "resin_printer", "sls_printer"})

MACHINE_CATALOG: list[dict[str, Any]] = [
    {"id": "prusa-mk4", "brand": "Prusa", "model": "MK4", "kind": "fdm_printer", "volume_mm": [250, 210, 220], "nozzle_mm": 0.4, "nozzle_options_mm": [0.25, 0.4, 0.6, 0.8], "layer_mm": [0.05, 0.30], "orca_model": "Prusa MK4", "xy_accuracy_mm": 0.20},
    {"id": "prusa-mini", "brand": "Prusa", "model": "MINI+", "kind": "fdm_printer", "volume_mm": [180, 180, 180], "nozzle_mm": 0.4, "nozzle_options_mm": [0.25, 0.4, 0.6], "layer_mm": [0.07, 0.25], "orca_model": "Prusa MINI", "xy_accuracy_mm": 0.20},
    {"id": "prusa-xl", "brand": "Prusa", "model": "XL", "kind": "fdm_printer", "volume_mm": [360, 360, 360], "nozzle_mm": 0.4, "nozzle_options_mm": [0.25, 0.4, 0.6, 0.8], "layer_mm": [0.05, 0.30], "orca_model": "Prusa XL", "xy_accuracy_mm": 0.20},
    {"id": "bambu-x1c", "brand": "Bambu Lab", "model": "X1 Carbon", "kind": "fdm_printer", "volume_mm": [256, 256, 256], "nozzle_mm": 0.4, "nozzle_options_mm": [0.2, 0.4, 0.6, 0.8], "layer_mm": [0.08, 0.28], "orca_model": "Bambu Lab X1 Carbon", "xy_accuracy_mm": 0.20},
    {"id": "bambu-p1s", "brand": "Bambu Lab", "model": "P1S", "kind": "fdm_printer", "volume_mm": [256, 256, 256], "nozzle_mm": 0.4, "nozzle_options_mm": [0.2, 0.4, 0.6, 0.8], "layer_mm": [0.08, 0.28], "orca_model": "Bambu Lab P1S", "xy_accuracy_mm": 0.20},
    {"id": "bambu-a1", "brand": "Bambu Lab", "model": "A1", "kind": "fdm_printer", "volume_mm": [256, 256, 256], "nozzle_mm": 0.4, "nozzle_options_mm": [0.2, 0.4, 0.6, 0.8], "layer_mm": [0.08, 0.28], "orca_model": "Bambu Lab A1", "xy_accuracy_mm": 0.20},
    {"id": "bambu-a1-mini", "brand": "Bambu Lab", "model": "A1 mini", "kind": "fdm_printer", "volume_mm": [180, 180, 180], "nozzle_mm": 0.4, "nozzle_options_mm": [0.2, 0.4, 0.6, 0.8], "layer_mm": [0.08, 0.28], "orca_model": "Bambu Lab A1 mini", "xy_accuracy_mm": 0.20},
    {"id": "ender-3-v3", "brand": "Creality", "model": "Ender 3 V3", "kind": "fdm_printer", "volume_mm": [220, 220, 250], "nozzle_mm": 0.4, "nozzle_options_mm": [0.4, 0.6, 0.8], "layer_mm": [0.08, 0.28], "orca_model": "Creality Ender-3 V3", "xy_accuracy_mm": 0.20},
    {"id": "voron-24", "brand": "Voron", "model": "2.4 300", "kind": "fdm_printer", "volume_mm": [300, 300, 300], "nozzle_mm": 0.4, "nozzle_options_mm": [0.4, 0.6, 0.8], "layer_mm": [0.08, 0.28], "orca_model": "Voron 2.4 300", "xy_accuracy_mm": 0.20},
    {"id": "elegoo-saturn-4", "brand": "Elegoo", "model": "Saturn 4", "kind": "resin_printer", "volume_mm": [218, 122, 220], "xy_mm": 0.019, "layer_mm": [0.03, 0.05], "xy_accuracy_mm": 0.10},
    {"id": "formlabs-form4", "brand": "Formlabs", "model": "Form 4", "kind": "resin_printer", "volume_mm": [200, 125, 210], "layer_mm": [0.025, 0.100], "xy_accuracy_mm": 0.10},
    {"id": "haas-vf2", "brand": "Haas", "model": "VF-2", "kind": "cnc_mill", "volume_mm": [762, 406, 508], "min_tool_mm": 1.0},
    {"id": "haas-minimill", "brand": "Haas", "model": "Mini Mill", "kind": "cnc_mill", "volume_mm": [406, 305, 254], "min_tool_mm": 1.0},
    {"id": "tormach-1100", "brand": "Tormach", "model": "1100M", "kind": "cnc_mill", "volume_mm": [457, 279, 413], "min_tool_mm": 1.5},
    {"id": "shapeoko-5", "brand": "Carbide 3D", "model": "Shapeoko 5 Pro", "kind": "cnc_router", "volume_mm": [838, 609, 127], "min_tool_mm": 1.5},
    {"id": "xcarve", "brand": "Inventables", "model": "X-Carve", "kind": "cnc_router", "volume_mm": [750, 750, 65], "min_tool_mm": 1.5},
    {"id": "nomad-3", "brand": "Carbide 3D", "model": "Nomad 3", "kind": "cnc_mill", "volume_mm": [203, 203, 76], "min_tool_mm": 0.8},
    {"id": "glowforge-pro", "brand": "Glowforge", "model": "Pro", "kind": "laser_cutter", "bed_mm": [495, 279], "kerf_mm": 0.2, "max_stock_mm": 12},
    {"id": "xtool-p2", "brand": "xTool", "model": "P2", "kind": "laser_cutter", "bed_mm": [600, 300], "kerf_mm": 0.15, "max_stock_mm": 16},
    {"id": "omtech-80", "brand": "OMTech", "model": "80W CO2", "kind": "laser_cutter", "bed_mm": [500, 300], "kerf_mm": 0.2, "max_stock_mm": 12},
    {"id": "generic-brake", "brand": "Generic", "model": "Press brake", "kind": "sheet_metal", "max_sheet_mm": [1200, 600], "min_flange_mm": 8, "bend_radius_mm": 1.0},
    {"id": "trumpf-tru", "brand": "TRUMPF", "model": "TruBend", "kind": "sheet_metal", "max_sheet_mm": [2000, 1000], "min_flange_mm": 6, "bend_radius_mm": 0.8},
    {"id": "amada-emk", "brand": "Amada", "model": "EMK turret", "kind": "sheet_metal", "max_sheet_mm": [2500, 1250], "min_flange_mm": 8, "kerf_mm": 0.0},
    {"id": "generic-waterjet", "brand": "Generic", "model": "Waterjet", "kind": "waterjet", "bed_mm": [1200, 600], "kerf_mm": 0.8},
    {"id": "cricut-maker", "brand": "Cricut", "model": "Maker 3", "kind": "vinyl_cutter", "bed_mm": [330, 1600], "kerf_mm": 0.1},
]

KIND_LABELS = {
    "fdm_printer": "FDM 3D printer",
    "resin_printer": "Resin 3D printer",
    "cnc_mill": "CNC mill",
    "cnc_router": "CNC router",
    "laser_cutter": "Laser cutter",
    "sheet_metal": "Sheet metal",
    "waterjet": "Waterjet",
    "vinyl_cutter": "Vinyl / knife cutter",
    "sls_printer": "SLS 3D printer",
    "other": "Other machine",
}

IMPROVE_TOGGLES = {
    "fdm_printer": [
        {"id": "split_to_bed", "label": "Split to fit plate", "hint": "If it exceeds the bed, split into named parts that assemble (glue / screws / snaps)."},
        {"id": "no_supports", "label": "Parts that don't need supports"},
        {"id": "simplify_print", "label": "Simplify print / easy assemble"},
        {"id": "no_screws", "label": "No screws"},
        {"id": "min_feature", "label": "Honor nozzle / min feature size"},
        {"id": "print_in_place", "label": "Prefer print-in-place joints"},
    ],
    "resin_printer": [
        {"id": "drain_holes", "label": "Add drain / vent holes on hollows"},
        {"id": "min_feature", "label": "Honor XY / layer minimums"},
        {"id": "no_supports", "label": "Orient to reduce supports"},
    ],
    "cnc_mill": [
        {"id": "tool_access", "label": "Keep tool access / no undercuts"},
        {"id": "stock_aware", "label": "Fit the named stock size"},
        {"id": "no_screws", "label": "Avoid tiny fasteners"},
        {"id": "min_feature", "label": "Honor minimum tool diameter"},
    ],
    "cnc_router": [
        {"id": "tool_access", "label": "2.5D / tool-access friendly"},
        {"id": "stock_aware", "label": "Fit sheet stock"},
        {"id": "min_feature", "label": "Honor bit diameter"},
    ],
    "laser_cutter": [
        {"id": "kerf_aware", "label": "Compensate for kerf"},
        {"id": "flat_pack", "label": "Flat-pack / tab-and-slot assemble"},
        {"id": "no_screws", "label": "No screws"},
        {"id": "stock_aware", "label": "Fit bed and max stock thickness"},
    ],
    "sheet_metal": [
        {"id": "bend_aware", "label": "Honor bend radius / min flange"},
        {"id": "no_screws", "label": "Prefer tabs / hems over screws"},
        {"id": "flat_pack", "label": "Keep unfoldable flats"},
    ],
    "waterjet": [
        {"id": "kerf_aware", "label": "Compensate for kerf"},
        {"id": "stock_aware", "label": "Fit bed / plate size"},
        {"id": "no_screws", "label": "Avoid tiny hardware"},
    ],
    "vinyl_cutter": [
        {"id": "flat_pack", "label": "Keep 2D cut paths"},
        {"id": "kerf_aware", "label": "Honor blade offset / kerf"},
    ],
    "other": [
        {"id": "simplify_print", "label": "Simplify for easier fabricate / assemble"},
        {"id": "no_screws", "label": "No screws"},
        {"id": "min_feature", "label": "Honor machine minimums"},
    ],
}

TOGGLE_HINTS = {
    "split_to_bed": "If the design exceeds the bed / build volume, split into named printable parts that assemble after print.",
    "no_supports": "Design self-supporting angles; avoid steep overhangs and bridging that needs supports.",
    "simplify_print": "Fewer parts, easy assemble, chamfers instead of tight fillets, avoid tiny details.",
    "no_screws": "Use snaps, press-fits, tabs, or captured nuts only if the user asked for fasteners.",
    "min_feature": "Do not go thinner than the machine's nozzle, tool, kerf, or layer minimums.",
    "print_in_place": "Prefer living hinges and captured joints that print assembled.",
    "drain_holes": "Hollow resin parts need drain and vent holes.",
    "tool_access": "Every pocket must be reachable with the tool; no 5-axis undercuts unless asked.",
    "stock_aware": "Keep the design inside the saved bed / volume / stock envelope.",
    "kerf_aware": "Leave kerf compensation notes and clearance on mating slots.",
    "flat_pack": "Prefer tab-and-slot or unfoldable flats that assemble without extra hardware.",
    "bend_aware": "Keep flanges at or above min flange; use the saved inside bend radius.",
}

# Keys absent from saved settings get these values (FDM split-to-fit on for P1S users).
DEFAULT_KIND_TOGGLES = {
    "fdm_printer": {"split_to_bed": True},
}

CUSTOM_IMPROVE_CATEGORIES = [
    "3D print",
    "CNC",
    "Sheet metal",
    "Laser",
    "Assembly",
    "Look / materials",
    "Improve Lab",
    "General",
]

LAB_BENCHMARKS = [
    {
        "id": "enclosure-mount",
        "title": "Enclosure + mount",
        "prompt": "create a enclosure and mount for a 60mm fan and a USB-C breakout",
        "why": "Good Improve test: missing sizes, hardware, and printability.",
    },
    {
        "id": "phone-stand",
        "title": "Phone stand",
        "prompt": "a simple phone stand that works in portrait and landscape",
        "why": "Short prompt — Improve should add dimensions and stability.",
    },
    {
        "id": "hinge-box",
        "title": "Print-in-place box",
        "prompt": "print-in-place box with a lid",
        "why": "Joints, clearances, and support-free design.",
    },
    {
        "id": "fan-bracket",
        "title": "Sheet-metal fan bracket",
        "prompt": "sheet metal bracket for a 40mm fan on a 2mm aluminum plate",
        "why": "Bend radius, hole pattern, and stock thickness.",
    },
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return str(uuid.uuid4())[:12]


def _row(row) -> dict[str, Any]:
    return dict(row) if row is not None else {}


def _json_load(raw: Any, fallback):
    if isinstance(raw, (dict, list)):
        return raw
    try:
        data = json.loads(raw or "")
        return data if data is not None else fallback
    except Exception:
        return fallback


def migrate_context_lab_schema(conn) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS context_machine_profiles (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            catalog_id TEXT,
            kind TEXT NOT NULL DEFAULT 'other',
            brand TEXT NOT NULL DEFAULT '',
            model TEXT NOT NULL DEFAULT '',
            name TEXT NOT NULL,
            specs_json TEXT NOT NULL DEFAULT '{}',
            is_active INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ctx_machine_user ON context_machine_profiles(user_id);

        CREATE TABLE IF NOT EXISTS context_improve_settings (
            user_id TEXT PRIMARY KEY,
            toggles_json TEXT NOT NULL DEFAULT '{}',
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS context_note_folders (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            name TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ctx_note_folder_user ON context_note_folders(user_id);

        CREATE TABLE IF NOT EXISTS context_notes (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            folder_id TEXT,
            name TEXT NOT NULL,
            body TEXT NOT NULL DEFAULT '',
            use_improve INTEGER NOT NULL DEFAULT 1,
            use_custom INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ctx_notes_user ON context_notes(user_id);

        CREATE TABLE IF NOT EXISTS context_custom_improves (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            name TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT 'General',
            prompt TEXT NOT NULL,
            note_ids_json TEXT NOT NULL DEFAULT '[]',
            include_settings INTEGER NOT NULL DEFAULT 1,
            include_machine INTEGER NOT NULL DEFAULT 1,
            is_active INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ctx_custom_user ON context_custom_improves(user_id);

        CREATE TABLE IF NOT EXISTS context_file_instructions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            name TEXT NOT NULL,
            instructions TEXT NOT NULL DEFAULT '',
            skill_ids_json TEXT NOT NULL DEFAULT '[]',
            knowledge_base_ids_json TEXT NOT NULL DEFAULT '[]',
            example TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS context_print_profiles (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            name TEXT NOT NULL,
            filament TEXT NOT NULL DEFAULT 'PLA',
            supports_enabled INTEGER NOT NULL DEFAULT 1,
            is_default INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ctx_print_user ON context_print_profiles(user_id);

        CREATE TABLE IF NOT EXISTS context_lab_sessions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            project_id TEXT NOT NULL,
            prompt TEXT NOT NULL DEFAULT '',
            slots_json TEXT NOT NULL DEFAULT '[]',
            status TEXT NOT NULL DEFAULT 'idle',
            stats_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ctx_lab_proj ON context_lab_sessions(project_id);

        CREATE TABLE IF NOT EXISTS context_drive_connections (
            user_id TEXT PRIMARY KEY,
            access_token TEXT,
            refresh_token TEXT,
            scopes TEXT,
            expires_at TEXT,
            email TEXT,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS context_customers (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            name TEXT NOT NULL,
            company TEXT NOT NULL DEFAULT '',
            notes TEXT NOT NULL DEFAULT '',
            settings_json TEXT NOT NULL DEFAULT '{}',
            is_active INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ctx_customer_user ON context_customers(user_id);

        CREATE TABLE IF NOT EXISTS knowledge_sources (
            id TEXT PRIMARY KEY,
            kb_id TEXT NOT NULL,
            source_type TEXT NOT NULL,
            url TEXT NOT NULL DEFAULT '',
            drive_folder_id TEXT NOT NULL DEFAULT '',
            label TEXT NOT NULL DEFAULT '',
            last_synced TEXT,
            extra_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_kb_sources_kb ON knowledge_sources(kb_id);
        """
    )
    for stmt in (
        "ALTER TABLE knowledge_items ADD COLUMN source_type TEXT NOT NULL DEFAULT 'upload'",
        "ALTER TABLE knowledge_items ADD COLUMN source_url TEXT NOT NULL DEFAULT ''",
    ):
        try:
            conn.execute(stmt)
        except Exception:
            pass


def _ensure() -> None:
    with get_conn() as conn:
        migrate_context_lab_schema(conn)


def is_3d_printer(kind: str | None) -> bool:
    return str(kind or "").strip().lower() in PRINTER_KINDS


def catalog_image_url(machine_id: str | None, kind: str | None = None) -> str:
    mid = str(machine_id or "").strip()
    if mid in ORCA_COVER_IDS:
        return f"/machine-thumbs/{mid}.png"
    if mid:
        return f"/machine-thumbs/{mid}.svg"
    key = str(kind or "other").strip() or "other"
    return f"/machine-thumbs/{key}.svg"


def catalog() -> list[dict[str, Any]]:
    out = []
    for row in MACHINE_CATALOG:
        item = dict(row)
        item["kind_label"] = KIND_LABELS.get(item["kind"], item["kind"])
        item["toggles"] = IMPROVE_TOGGLES.get(item["kind"], IMPROVE_TOGGLES["other"])
        item["image_url"] = catalog_image_url(item["id"], item["kind"])
        if is_3d_printer(item.get("kind")):
            item["fit_clearances"] = printer_fit_clearances({"kind": item["kind"], "brand": item["brand"], "model": item["model"], "specs": item})
        out.append(item)
    return out


def kinds() -> list[dict[str, str]]:
    return [{"id": key, "label": label} for key, label in KIND_LABELS.items()]


def toggles_for_kind(kind: str) -> list[dict[str, str]]:
    key = str(kind or "other").strip().lower()
    return list(IMPROVE_TOGGLES.get(key) or IMPROVE_TOGGLES["other"])


def example_prompt() -> dict[str, str]:
    idx = int(datetime.now(timezone.utc).timestamp() * 1000) % len(EXAMPLE_PROMPTS)
    text = EXAMPLE_PROMPTS[idx]
    return {"prompt": text, "improved": _canned_example(text)}


def _canned_example(prompt: str) -> str:
    seed = (prompt or "a small enclosure").strip()
    return (
        f"{seed} — parametric CAD: named bodies, millimetre dimensions, realistic shop materials. "
        "Keep printable / machinable for the user's saved machine. Add missing sizes, wall thickness, "
        "and assembly notes. Do not invent fasteners if no-screws is on."
    )


def _profile_row(row) -> dict[str, Any]:
    data = _row(row)
    data["specs"] = _json_load(data.pop("specs_json", "{}"), {})
    data["is_active"] = bool(data.get("is_active"))
    data["kind_label"] = KIND_LABELS.get(data.get("kind") or "", data.get("kind") or "")
    data["image_url"] = catalog_image_url(data.get("catalog_id"), data.get("kind"))
    data["printer_tolerance"] = _printer_tolerance_on(data)
    if is_3d_printer(data.get("kind")):
        data["fit_clearances"] = printer_fit_clearances(data)
    return data


def list_profiles(user_id: str) -> list[dict[str, Any]]:
    _ensure()
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM context_machine_profiles WHERE user_id = ? ORDER BY is_active DESC, updated_at DESC",
            (user_id,),
        ).fetchall()
    return [_profile_row(r) for r in rows]


def active_profile(user_id: str) -> dict[str, Any] | None:
    profiles = list_profiles(user_id)
    return next((p for p in profiles if p.get("is_active")), profiles[0] if profiles else None)


def save_profile(
    user_id: str,
    *,
    profile_id: str | None = None,
    catalog_id: str | None = None,
    kind: str | None = None,
    brand: str = "",
    model: str = "",
    name: str | None = None,
    specs: dict[str, Any] | None = None,
    activate: bool = True,
) -> dict[str, Any]:
    _ensure()
    catalog_row = next((c for c in MACHINE_CATALOG if c["id"] == str(catalog_id or "")), None)
    if catalog_row:
        kind = kind or catalog_row["kind"]
        brand = brand or catalog_row["brand"]
        model = model or catalog_row["model"]
        merged = {k: v for k, v in catalog_row.items() if k not in {"id", "brand", "model", "kind"}}
        if specs:
            merged.update(specs)
        specs = merged
    kind = str(kind or "other").strip().lower() or "other"
    if kind not in KIND_LABELS:
        kind = "other"
    brand = str(brand or "").strip()[:80]
    model = str(model or "").strip()[:80]
    name = (name or f"{brand} {model}".strip() or "Custom machine")[:120]
    specs = specs if isinstance(specs, dict) else {}
    if is_3d_printer(kind):
        specs["printer_tolerance"] = bool(specs.get("printer_tolerance"))
    else:
        specs.pop("printer_tolerance", None)
    now = _now()
    pid = (profile_id or "").strip() or _new_id()
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT id FROM context_machine_profiles WHERE id = ? AND user_id = ?",
            (pid, user_id),
        ).fetchone()
        if activate:
            conn.execute(
                "UPDATE context_machine_profiles SET is_active = 0 WHERE user_id = ?",
                (user_id,),
            )
        if existing:
            conn.execute(
                """
                UPDATE context_machine_profiles
                   SET catalog_id=?, kind=?, brand=?, model=?, name=?, specs_json=?,
                       is_active=?, updated_at=?
                 WHERE id=? AND user_id=?
                """,
                (
                    catalog_id,
                    kind,
                    brand,
                    model,
                    name,
                    json.dumps(specs),
                    1 if activate else 0,
                    now,
                    pid,
                    user_id,
                ),
            )
        else:
            conn.execute(
                """
                INSERT INTO context_machine_profiles
                  (id, user_id, catalog_id, kind, brand, model, name, specs_json, is_active, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (pid, user_id, catalog_id, kind, brand, model, name, json.dumps(specs), 1 if activate else 0, now, now),
            )
    return next(p for p in list_profiles(user_id) if p["id"] == pid)


def delete_profile(user_id: str, profile_id: str) -> None:
    _ensure()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT is_active FROM context_machine_profiles WHERE id = ? AND user_id = ?",
            (profile_id, user_id),
        ).fetchone()
        was_active = bool(row["is_active"]) if row else False
        conn.execute(
            "DELETE FROM context_machine_profiles WHERE id = ? AND user_id = ?",
            (profile_id, user_id),
        )
        if was_active:
            nxt = conn.execute(
                """
                SELECT id FROM context_machine_profiles
                 WHERE user_id = ?
                 ORDER BY updated_at DESC
                 LIMIT 1
                """,
                (user_id,),
            ).fetchone()
            if nxt:
                conn.execute(
                    "UPDATE context_machine_profiles SET is_active = 1 WHERE id = ? AND user_id = ?",
                    (nxt["id"], user_id),
                )


def _customer_row(row) -> dict[str, Any]:
    data = _row(row)
    data["settings"] = _json_load(data.pop("settings_json", "{}"), {})
    data["is_active"] = bool(data.get("is_active"))
    return data


def list_customers(user_id: str) -> list[dict[str, Any]]:
    _ensure()
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM context_customers WHERE user_id = ? ORDER BY is_active DESC, updated_at DESC",
            (user_id,),
        ).fetchall()
    return [_customer_row(r) for r in rows]


def active_customer(user_id: str) -> dict[str, Any] | None:
    customers = list_customers(user_id)
    return next((c for c in customers if c.get("is_active")), customers[0] if customers else None)


def save_customer(
    user_id: str,
    *,
    customer_id: str | None = None,
    name: str,
    company: str = "",
    notes: str = "",
    settings: dict[str, Any] | None = None,
    activate: bool = True,
) -> dict[str, Any]:
    _ensure()
    name = str(name or "").strip()[:120]
    if not name:
        raise ValueError("Customer name is required")
    company = str(company or "").strip()[:120]
    notes = str(notes or "")[:20_000]
    settings = settings if isinstance(settings, dict) else {}
    now = _now()
    cid = (customer_id or "").strip() or _new_id()
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT id FROM context_customers WHERE id = ? AND user_id = ?",
            (cid, user_id),
        ).fetchone()
        if activate:
            conn.execute(
                "UPDATE context_customers SET is_active = 0 WHERE user_id = ?",
                (user_id,),
            )
        if existing:
            conn.execute(
                """
                UPDATE context_customers
                   SET name=?, company=?, notes=?, settings_json=?, is_active=?, updated_at=?
                 WHERE id=? AND user_id=?
                """,
                (name, company, notes, json.dumps(settings), 1 if activate else 0, now, cid, user_id),
            )
        else:
            conn.execute(
                """
                INSERT INTO context_customers
                  (id, user_id, name, company, notes, settings_json, is_active, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (cid, user_id, name, company, notes, json.dumps(settings), 1 if activate else 0, now, now),
            )
    return next(c for c in list_customers(user_id) if c["id"] == cid)


PRINT_FILAMENTS = ("PLA", "PETG", "ABS", "ASA", "TPU", "Nylon", "PLA-CF")


def _print_profile_row(row) -> dict[str, Any]:
    data = dict(row)
    return {
        "id": data["id"],
        "name": data["name"],
        "filament": data.get("filament") or "PLA",
        "supports_enabled": bool(int(data.get("supports_enabled") or 0)),
        "is_default": bool(int(data.get("is_default") or 0)),
        "created_at": data.get("created_at"),
        "updated_at": data.get("updated_at"),
    }


def list_print_profiles(user_id: str) -> list[dict[str, Any]]:
    _ensure()
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT * FROM context_print_profiles
             WHERE user_id = ?
             ORDER BY is_default DESC, lower(name)
            """,
            (user_id,),
        ).fetchall()
    return [_print_profile_row(r) for r in rows]


def default_print_profile(user_id: str) -> dict[str, Any] | None:
    rows = list_print_profiles(user_id)
    return next((r for r in rows if r["is_default"]), rows[0] if rows else None)


def save_print_profile(
    user_id: str,
    *,
    profile_id: str | None = None,
    name: str = "",
    filament: str = "PLA",
    supports_enabled: bool = True,
    is_default: bool = False,
) -> dict[str, Any]:
    _ensure()
    uid = str(user_id or "").strip()
    label = str(name or "").strip() or "Print profile"
    fil = str(filament or "PLA").strip().upper()
    if fil not in PRINT_FILAMENTS:
        fil = "PLA"
    pid = str(profile_id or "").strip() or _new_id()
    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        if is_default:
            conn.execute(
                "UPDATE context_print_profiles SET is_default = 0 WHERE user_id = ?",
                (uid,),
            )
        existing = conn.execute(
            "SELECT id FROM context_print_profiles WHERE id = ? AND user_id = ?",
            (pid, uid),
        ).fetchone()
        if existing:
            conn.execute(
                """
                UPDATE context_print_profiles
                   SET name=?, filament=?, supports_enabled=?, is_default=?, updated_at=?
                 WHERE id=? AND user_id=?
                """,
                (label, fil, 1 if supports_enabled else 0, 1 if is_default else 0, now, pid, uid),
            )
        else:
            if not list_print_profiles(uid):
                is_default = True
            conn.execute(
                """
                INSERT INTO context_print_profiles
                  (id, user_id, name, filament, supports_enabled, is_default, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (pid, uid, label, fil, 1 if supports_enabled else 0, 1 if is_default else 0, now, now),
            )
    return next(p for p in list_print_profiles(uid) if p["id"] == pid)


def delete_print_profile(user_id: str, profile_id: str) -> None:
    _ensure()
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM context_print_profiles WHERE id = ? AND user_id = ?",
            (profile_id, user_id),
        )
        remaining = conn.execute(
            "SELECT id FROM context_print_profiles WHERE user_id = ? ORDER BY updated_at DESC",
            (user_id,),
        ).fetchall()
        if remaining and not conn.execute(
            "SELECT 1 FROM context_print_profiles WHERE user_id = ? AND is_default = 1",
            (user_id,),
        ).fetchone():
            conn.execute(
                "UPDATE context_print_profiles SET is_default = 1 WHERE id = ?",
                (remaining[0]["id"],),
            )


def set_default_print_profile(user_id: str, profile_id: str) -> dict[str, Any]:
    rows = list_print_profiles(user_id)
    found = next((r for r in rows if r["id"] == profile_id), None)
    if not found:
        raise ValueError("Print profile not found")
    return save_print_profile(
        user_id,
        profile_id=found["id"],
        name=found["name"],
        filament=found["filament"],
        supports_enabled=found["supports_enabled"],
        is_default=True,
    )


def delete_customer(user_id: str, customer_id: str) -> None:
    _ensure()
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM context_customers WHERE id = ? AND user_id = ?",
            (customer_id, user_id),
        )


def get_settings(user_id: str) -> dict[str, Any]:
    _ensure()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT toggles_json, updated_at FROM context_improve_settings WHERE user_id = ?",
            (user_id,),
        ).fetchone()
    toggles = _json_load(row["toggles_json"] if row else "{}", {})
    if not isinstance(toggles, dict):
        toggles = {}
    profile = active_profile(user_id)
    kind = (profile or {}).get("kind") or "other"
    defs = toggles_for_kind(kind)
    toggles = _apply_toggle_defaults(kind, toggles)
    return {
        "toggles": toggles,
        "definitions": defs,
        "machine_kind": kind,
        "apply_when_improve": True,
        "hint": "These adjust Improve when Improve is enabled — they do not run on their own.",
        "updated_at": row["updated_at"] if row else None,
    }


def save_settings(user_id: str, toggles: dict[str, Any] | None) -> dict[str, Any]:
    _ensure()
    clean = {}
    if isinstance(toggles, dict):
        for key, value in toggles.items():
            kid = re.sub(r"[^a-z0-9_]+", "", str(key).lower())[:40]
            if kid:
                clean[kid] = bool(value)
    now = _now()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO context_improve_settings (user_id, toggles_json, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET toggles_json=excluded.toggles_json, updated_at=excluded.updated_at
            """,
            (user_id, json.dumps(clean), now),
        )
    return get_settings(user_id)


def list_note_folders(user_id: str) -> list[dict[str, Any]]:
    _ensure()
    with get_conn() as conn:
        folders = conn.execute(
            "SELECT * FROM context_note_folders WHERE user_id = ? ORDER BY sort_order, name",
            (user_id,),
        ).fetchall()
        notes = conn.execute(
            "SELECT * FROM context_notes WHERE user_id = ? ORDER BY updated_at DESC",
            (user_id,),
        ).fetchall()
    by_folder: dict[str, list] = {}
    loose = []
    for note in notes:
        item = _row(note)
        item["use_improve"] = bool(item.get("use_improve"))
        item["use_custom"] = bool(item.get("use_custom"))
        fid = item.get("folder_id")
        if fid:
            by_folder.setdefault(fid, []).append(item)
        else:
            loose.append(item)
    out = []
    for folder in folders:
        row = _row(folder)
        row["notes"] = by_folder.get(row["id"], [])
        out.append(row)
    if loose:
        out.append({"id": "", "name": "Ungrouped", "notes": loose, "virtual": True})
    return out


def save_note_folder(user_id: str, *, folder_id: str | None = None, name: str) -> dict[str, Any]:
    _ensure()
    fid = (folder_id or "").strip() or _new_id()
    name = (name or "Notes").strip()[:80] or "Notes"
    now = _now()
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT id FROM context_note_folders WHERE id = ? AND user_id = ?",
            (fid, user_id),
        ).fetchone()
        if existing:
            conn.execute(
                "UPDATE context_note_folders SET name = ? WHERE id = ? AND user_id = ?",
                (name, fid, user_id),
            )
        else:
            conn.execute(
                "INSERT INTO context_note_folders (id, user_id, name, sort_order, created_at) VALUES (?, ?, ?, 0, ?)",
                (fid, user_id, name, now),
            )
    folders = list_note_folders(user_id)
    return next((f for f in folders if f.get("id") == fid), {"id": fid, "name": name, "notes": []})


def delete_note_folder(user_id: str, folder_id: str) -> None:
    _ensure()
    with get_conn() as conn:
        conn.execute(
            "UPDATE context_notes SET folder_id = NULL WHERE user_id = ? AND folder_id = ?",
            (user_id, folder_id),
        )
        conn.execute(
            "DELETE FROM context_note_folders WHERE id = ? AND user_id = ?",
            (folder_id, user_id),
        )


def save_note(
    user_id: str,
    *,
    note_id: str | None = None,
    folder_id: str | None = None,
    name: str,
    body: str = "",
    use_improve: bool = True,
    use_custom: bool = True,
) -> dict[str, Any]:
    _ensure()
    nid = (note_id or "").strip() or _new_id()
    name = (name or "Note").strip()[:120] or "Note"
    body = str(body or "")[:20_000]
    now = _now()
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT id FROM context_notes WHERE id = ? AND user_id = ?",
            (nid, user_id),
        ).fetchone()
        if existing:
            conn.execute(
                """
                UPDATE context_notes
                   SET folder_id=?, name=?, body=?, use_improve=?, use_custom=?, updated_at=?
                 WHERE id=? AND user_id=?
                """,
                (folder_id or None, name, body, 1 if use_improve else 0, 1 if use_custom else 0, now, nid, user_id),
            )
        else:
            conn.execute(
                """
                INSERT INTO context_notes
                  (id, user_id, folder_id, name, body, use_improve, use_custom, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (nid, user_id, folder_id or None, name, body, 1 if use_improve else 0, 1 if use_custom else 0, now, now),
            )
    for folder in list_note_folders(user_id):
        for note in folder.get("notes") or []:
            if note["id"] == nid:
                return note
    return {"id": nid, "name": name, "body": body, "use_improve": use_improve, "use_custom": use_custom}


def delete_note(user_id: str, note_id: str) -> None:
    _ensure()
    with get_conn() as conn:
        conn.execute("DELETE FROM context_notes WHERE id = ? AND user_id = ?", (note_id, user_id))


def list_custom_improves(user_id: str) -> list[dict[str, Any]]:
    _ensure()
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM context_custom_improves WHERE user_id = ? ORDER BY is_active DESC, updated_at DESC",
            (user_id,),
        ).fetchall()
    out = []
    for row in rows:
        item = _row(row)
        item["note_ids"] = _json_load(item.pop("note_ids_json", "[]"), [])
        item["include_settings"] = bool(item.get("include_settings"))
        item["include_machine"] = bool(item.get("include_machine"))
        item["is_active"] = bool(item.get("is_active"))
        out.append(item)
    return out


def save_custom_improve(
    user_id: str,
    *,
    custom_id: str | None = None,
    name: str,
    category: str = "General",
    prompt: str,
    note_ids: list[str] | None = None,
    include_settings: bool = True,
    include_machine: bool = True,
    activate: bool | None = None,
) -> dict[str, Any]:
    _ensure()
    cid = (custom_id or "").strip() or _new_id()
    name = (name or "Custom Improve").strip()[:120] or "Custom Improve"
    category = (category or "General").strip()[:40] or "General"
    prompt = str(prompt or "").strip()[:12_000]
    if not prompt:
        raise ValueError("Custom Improve prompt is required")
    ids = [str(x) for x in (note_ids or []) if str(x).strip()][:40]
    now = _now()
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT is_active FROM context_custom_improves WHERE id = ? AND user_id = ?",
            (cid, user_id),
        ).fetchone()
        is_active = existing["is_active"] if existing and activate is None else (1 if activate else 0)
        if is_active:
            conn.execute(
                "UPDATE context_custom_improves SET is_active = 0 WHERE user_id = ?",
                (user_id,),
            )
        if existing:
            conn.execute(
                """
                UPDATE context_custom_improves
                   SET name=?, category=?, prompt=?, note_ids_json=?, include_settings=?,
                       include_machine=?, is_active=?, updated_at=?
                 WHERE id=? AND user_id=?
                """,
                (
                    name,
                    category,
                    prompt,
                    json.dumps(ids),
                    1 if include_settings else 0,
                    1 if include_machine else 0,
                    1 if is_active else 0,
                    now,
                    cid,
                    user_id,
                ),
            )
        else:
            conn.execute(
                """
                INSERT INTO context_custom_improves
                  (id, user_id, name, category, prompt, note_ids_json, include_settings,
                   include_machine, is_active, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    cid,
                    user_id,
                    name,
                    category,
                    prompt,
                    json.dumps(ids),
                    1 if include_settings else 0,
                    1 if include_machine else 0,
                    1 if is_active else 0,
                    now,
                    now,
                ),
            )
    return next(c for c in list_custom_improves(user_id) if c["id"] == cid)


def set_custom_improve_active(user_id: str, custom_id: str | None) -> dict[str, Any]:
    _ensure()
    with get_conn() as conn:
        conn.execute("UPDATE context_custom_improves SET is_active = 0 WHERE user_id = ?", (user_id,))
        if custom_id:
            conn.execute(
                "UPDATE context_custom_improves SET is_active = 1, updated_at = ? WHERE id = ? AND user_id = ?",
                (_now(), custom_id, user_id),
            )
    return {"custom_improves": list_custom_improves(user_id), "active_id": custom_id or None}


def delete_custom_improve(user_id: str, custom_id: str) -> None:
    _ensure()
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM context_custom_improves WHERE id = ? AND user_id = ?",
            (custom_id, user_id),
        )


def compose_custom_improve_draft(
    user_id: str,
    *,
    note_ids: list[str] | None = None,
    include_settings: bool = True,
    include_machine: bool = True,
    extra: str = "",
) -> str:
    parts = [
        "You are writing a reusable Improve-prompt overlay for Render Studio.",
        "Do not replace CAD/Mesh/Render Improve — add constraints the user's machine and notes require.",
        "Keep it under 400 words. Imperative bullets. No marketing.",
    ]
    if include_machine:
        machine = _machine_block(user_id)
        if machine:
            parts.append("Machine:\n" + machine)
    if include_settings:
        settings_block = _settings_block(user_id)
        if settings_block:
            parts.append("Toggles (apply when Improve is on):\n" + settings_block)
    notes = _notes_block(user_id, note_ids, custom=True)
    if notes:
        parts.append("Context notes:\n" + notes)
    if extra.strip():
        parts.append("Author request:\n" + extra.strip()[:2000])
    return "\n\n".join(parts)


def list_file_instructions(user_id: str) -> list[dict[str, Any]]:
    _ensure()
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM context_file_instructions WHERE user_id = ? ORDER BY updated_at DESC",
            (user_id,),
        ).fetchall()
    out = []
    for row in rows:
        item = _row(row)
        item["skill_ids"] = _json_load(item.pop("skill_ids_json", "[]"), [])
        item["knowledge_base_ids"] = _json_load(item.pop("knowledge_base_ids_json", "[]"), [])
        out.append(item)
    return out


def save_file_instruction(
    user_id: str,
    *,
    instruction_id: str | None = None,
    name: str,
    instructions: str,
    skill_ids: list[str] | None = None,
    knowledge_base_ids: list[str] | None = None,
    example: str = "",
) -> dict[str, Any]:
    _ensure()
    iid = (instruction_id or "").strip() or _new_id()
    name = (name or "File instructions").strip()[:120] or "File instructions"
    instructions = str(instructions or "")[:12_000]
    skills = [str(s).strip().lower() for s in (skill_ids or []) if str(s).strip()][:20]
    kbs = [str(s).strip() for s in (knowledge_base_ids or []) if str(s).strip()][:12]
    now = _now()
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT id FROM context_file_instructions WHERE id = ? AND user_id = ?",
            (iid, user_id),
        ).fetchone()
        if existing:
            conn.execute(
                """
                UPDATE context_file_instructions
                   SET name=?, instructions=?, skill_ids_json=?, knowledge_base_ids_json=?, example=?, updated_at=?
                 WHERE id=? AND user_id=?
                """,
                (name, instructions, json.dumps(skills), json.dumps(kbs), example[:8000], now, iid, user_id),
            )
        else:
            conn.execute(
                """
                INSERT INTO context_file_instructions
                  (id, user_id, name, instructions, skill_ids_json, knowledge_base_ids_json, example, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (iid, user_id, name, instructions, json.dumps(skills), json.dumps(kbs), example[:8000], now, now),
            )
    return next(i for i in list_file_instructions(user_id) if i["id"] == iid)


def delete_file_instruction(user_id: str, instruction_id: str) -> None:
    _ensure()
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM context_file_instructions WHERE id = ? AND user_id = ?",
            (instruction_id, user_id),
        )


def _coerce_mm(value: Any, default: float | None = None) -> float | None:
    try:
        num = float(value)
    except (TypeError, ValueError):
        return default
    if num <= 0:
        return default
    return num


def _spec_mm(profile: dict[str, Any], specs: dict[str, Any], key: str) -> float | None:
    if specs.get(key) not in (None, ""):
        return _coerce_mm(specs.get(key))
    return _coerce_mm(profile.get(key))


def printer_fit_clearances(profile: dict[str, Any] | None) -> dict[str, Any] | None:
    """Per-printer assembly clearances for Improve (FDM / resin / SLS)."""
    if not profile or not is_3d_printer(profile.get("kind")):
        return None
    specs = profile.get("specs") if isinstance(profile.get("specs"), dict) else {}
    kind = str(profile.get("kind") or "")
    nozzle = _spec_mm(profile, specs, "nozzle_mm")
    xy = _spec_mm(profile, specs, "xy_mm")
    named = f"{profile.get('brand') or ''} {profile.get('model') or profile.get('name') or ''}".strip() or "this printer"
    if kind == "resin_printer":
        sliding, snug, loose, hole = 0.12, 0.08, 0.15, 0.10
        if xy and xy <= 0.05:
            sliding, snug, loose, hole = 0.10, 0.05, 0.14, 0.08
        source = f"resin/SLA typical accuracy (XY {xy:.3f} mm)" if xy else "resin/SLA typical accuracy (~0.10–0.15 mm)"
    elif kind == "sls_printer":
        sliding, snug, loose, hole = 0.22, 0.16, 0.28, 0.20
        source = "SLS/nylon typical accuracy (~0.20–0.25 mm)"
    else:
        n = nozzle or 0.4
        if n <= 0.25:
            sliding, snug, loose, hole = 0.15, 0.12, 0.20, 0.14
            source = f"fine FDM {n:.2f} mm nozzle"
        else:
            sliding = round(min(0.25, max(0.16, n * 0.5)), 2)
            snug = round(min(0.18, max(0.12, n * 0.375)), 2)
            loose = round(min(0.32, max(0.24, n * 0.7)), 2)
            hole = round(min(0.22, max(0.14, n * 0.4)), 2)
            source = f"FDM {n:.2f} mm nozzle (~half-nozzle sliding fit)"
    return {
        "sliding_mm": sliding,
        "snug_mm": snug,
        "loose_mm": loose,
        "hole_mm": hole,
        "source": source,
        "machine": named,
        "kind": kind,
        "nozzle_mm": nozzle,
    }


def _printer_tolerance_on(profile: dict[str, Any] | None) -> bool:
    if not profile or not is_3d_printer(profile.get("kind")):
        return False
    specs = profile.get("specs") if isinstance(profile.get("specs"), dict) else {}
    val = specs.get("printer_tolerance")
    if val in (None, "", 0, "0", "false", "False", "off"):
        return False
    return bool(val)


def _tolerance_prompt_block(profile: dict[str, Any] | None) -> str:
    clear = printer_fit_clearances(profile)
    if not clear:
        return ""
    machine = clear["machine"]
    return (
        f"Printer fit tolerance (enabled for {machine}):\n"
        f"Add functional clearances so printed parts fit and assemble on this printer after printing. "
        f"Do not leave zero-clearance mates. Add clearance on pins, holes, lids, snaps, screw bosses, and press-fits.\n"
        f"Use these starting clearances derived from {clear['source']}:\n"
        f"- sliding / running fit: {clear['sliding_mm']:.2f} mm per side\n"
        f"- press / snug: {clear['snug_mm']:.2f} mm\n"
        f"- loose / lid / slip: {clear['loose_mm']:.2f} mm\n"
        f"- hole undersize compensation: {clear['hole_mm']:.2f} mm\n"
        "Keep named parametric gaps (not coincident faces) so parts assemble on this machine."
    )


def _machine_block(user_id: str) -> str:
    profile = active_profile(user_id)
    if not profile:
        return ""
    specs = profile.get("specs") or {}
    bits = [
        f"{profile.get('brand') or ''} {profile.get('model') or profile.get('name')}".strip(),
        KIND_LABELS.get(profile.get("kind") or "", profile.get("kind") or ""),
    ]
    vol = specs.get("volume_mm")
    if isinstance(vol, list) and len(vol) >= 3:
        bits.append(f"build volume {vol[0]}×{vol[1]}×{vol[2]} mm")
    bed = specs.get("bed_mm")
    if isinstance(bed, list) and len(bed) >= 2:
        bits.append(f"bed {bed[0]}×{bed[1]} mm")
    for key, label in (
        ("nozzle_mm", "nozzle"),
        ("kerf_mm", "kerf"),
        ("min_tool_mm", "min tool"),
        ("max_stock_mm", "max stock"),
        ("min_flange_mm", "min flange"),
        ("bend_radius_mm", "bend radius"),
    ):
        if specs.get(key) not in (None, ""):
            bits.append(f"{label} {specs[key]} mm")
    if specs.get("layer_mm"):
        bits.append(f"layer {specs['layer_mm']} mm")
    extra = str(specs.get("notes") or "").strip()
    if extra:
        bits.append(extra[:400])
    return "; ".join(b for b in bits if b)


def _apply_toggle_defaults(kind: str, toggles: dict[str, Any]) -> dict[str, Any]:
    merged = dict(toggles)
    for key, value in (DEFAULT_KIND_TOGGLES.get(kind) or {}).items():
        if key not in merged:
            merged[key] = value
    return merged


def _plate_envelope_text(profile: dict[str, Any] | None) -> str:
    specs = (profile or {}).get("specs") or {}
    bits: list[str] = []
    vol = specs.get("volume_mm")
    if isinstance(vol, list) and len(vol) >= 3:
        bits.append(f"build volume {vol[0]}×{vol[1]}×{vol[2]} mm")
    bed = specs.get("bed_mm")
    if isinstance(bed, list) and len(bed) >= 2:
        bits.append(f"bed {bed[0]}×{bed[1]} mm")
    return " / ".join(bits) or "the active machine build volume / bed"


def _split_to_bed_join_text(toggles: dict[str, Any]) -> str:
    no_screws = bool(toggles.get("no_screws"))
    pip = bool(toggles.get("print_in_place"))
    if no_screws and pip:
        return (
            "Join with glue, snaps, press-fits, printed pins, or print-in-place living hinges; "
            "do not use screws."
        )
    if no_screws:
        return "Join with glue, snaps, press-fits, or printed pins; do not use screws."
    if pip:
        return (
            "Prefer living hinges / print-in-place joints where the connected pair still fits the plate; "
            "otherwise join split parts with glue, screws, alignment pins/slots, or snaps."
        )
    return (
        "Join with glue, screws, alignment pins/slots, or snap fits — "
        "pick the method that matches the other FDM flags."
    )


def _split_to_bed_prompt_hint(profile: dict[str, Any] | None, toggles: dict[str, Any]) -> str:
    envelope = _plate_envelope_text(profile)
    parts = [
        f"If the design envelope exceeds {envelope}, split into named printable sub-parts that each fit the plate with a few mm margin.",
        "Name each sub-part, add alignment pins/slots or similar mates, and specify the join method.",
        _split_to_bed_join_text(toggles),
    ]
    if toggles.get("print_in_place"):
        parts.append(
            "Print-in-place is allowed only where the connected region still fits the plate; "
            "still split if the whole thing cannot fit."
        )
    if toggles.get("simplify_print"):
        parts.append(
            "Keep assembly simple (few unique fasteners, clear mates), but do not cancel split-to-fit — "
            "fitting the plate wins."
        )
    return " ".join(parts)


def _settings_block(user_id: str) -> str:
    data = get_settings(user_id)
    toggles = data.get("toggles") or {}
    profile = active_profile(user_id)
    lines = []
    for item in data.get("definitions") or []:
        if not toggles.get(item["id"]):
            continue
        if item["id"] == "split_to_bed":
            hint = _split_to_bed_prompt_hint(profile, toggles)
        else:
            hint = TOGGLE_HINTS.get(item["id"], item["label"])
        lines.append(f"- {item['label']}: {hint}")
    return "\n".join(lines)


def _customer_block(user_id: str) -> str:
    customer = active_customer(user_id)
    if not customer:
        return ""
    bits = [str(customer.get("name") or "").strip()]
    company = str(customer.get("company") or "").strip()
    if company:
        bits.append(company)
    notes = str(customer.get("notes") or "").strip()
    extra = str((customer.get("settings") or {}).get("notes") or "").strip()
    body = "\n".join(part for part in (notes, extra) if part)[:2500]
    label = " · ".join(b for b in bits if b)
    if not label and not body:
        return ""
    if body:
        return f"{label}\n{body}" if label else body
    return label


def _notes_block(user_id: str, note_ids: list[str] | None, *, custom: bool) -> str:
    wanted = {str(i) for i in (note_ids or []) if str(i).strip()}
    chunks = []
    for folder in list_note_folders(user_id):
        for note in folder.get("notes") or []:
            if wanted and note["id"] not in wanted:
                continue
            if not wanted:
                if custom and not note.get("use_custom"):
                    continue
                if not custom and not note.get("use_improve"):
                    continue
            body = str(note.get("body") or "").strip()
            if not body:
                continue
            chunks.append(f"### {note.get('name')}\n{body[:2500]}")
    return "\n\n".join(chunks[:12])


def improve_context(user_id: str, *, custom_improve_id: str | None = None) -> dict[str, Any]:
    """Payload injected into /api/prompt/improve — not a second prompt engine."""
    machine = active_profile(user_id)
    settings_data = get_settings(user_id)
    customs = list_custom_improves(user_id)
    active_custom = None
    if custom_improve_id:
        active_custom = next((c for c in customs if c["id"] == custom_improve_id), None)
    else:
        active_custom = next((c for c in customs if c.get("is_active")), None)
    notes = _notes_block(
        user_id,
        (active_custom or {}).get("note_ids") if active_custom else None,
        custom=bool(active_custom),
    )
    settings_text = ""
    if not active_custom or active_custom.get("include_settings"):
        settings_text = _settings_block(user_id)
    machine_text = ""
    if not active_custom or active_custom.get("include_machine"):
        machine_text = _machine_block(user_id)
    customer_text = _customer_block(user_id)
    parts = []
    if machine_text:
        parts.append(f"User machine context:\n{machine_text}")
    if machine and _printer_tolerance_on(machine) and (not active_custom or active_custom.get("include_machine")):
        tol = _tolerance_prompt_block(machine)
        if tol:
            parts.append(tol)
    if customer_text:
        parts.append(f"Customer / client context:\n{customer_text}")
    if settings_text:
        parts.append(
            "Improve-only fabrication toggles (apply because Improve is on; do not ignore the user's request):\n"
            + settings_text
        )
    if notes:
        parts.append("User context notes:\n" + notes)
    if active_custom:
        parts.append(
            "Custom Improve overlay (user-authored; keep the Studio Improve rules for this mode, then apply this):\n"
            + str(active_custom.get("prompt") or "")
        )
    return {
        "machine": machine,
        "customer": active_customer(user_id),
        "settings": settings_data,
        "custom_improve": active_custom,
        "uses_builtin_improve": active_custom is None,
        "block": "\n\n".join(parts).strip(),
    }


def snapshot(user_id: str) -> dict[str, Any]:
    settings_data = get_settings(user_id)
    return {
        "catalog": catalog(),
        "kinds": kinds(),
        "categories": CUSTOM_IMPROVE_CATEGORIES,
        "benchmarks": LAB_BENCHMARKS,
        "example": example_prompt(),
        "profiles": list_profiles(user_id),
        "active_profile": active_profile(user_id),
        "customers": list_customers(user_id),
        "active_customer": active_customer(user_id),
        "settings": settings_data,
        "note_folders": list_note_folders(user_id),
        "custom_improves": list_custom_improves(user_id),
        "file_instructions": list_file_instructions(user_id),
        "drive": drive_status(user_id),
        "lab_name": "Improve Lab",
        "lab_tagline": "Compare original vs up to three Improve overlays in four viewports.",
        "print_profiles": list_print_profiles(user_id),
        "default_print_profile": default_print_profile(user_id),
        "filaments": list(PRINT_FILAMENTS),
    }


def lab_dir(project_path: Path, session_id: str) -> Path:
    root = Path(project_path) / "references" / IMPROVE_LAB_DIRNAME / session_id
    root.mkdir(parents=True, exist_ok=True)
    return root


def _session_row(row) -> dict[str, Any]:
    data = _row(row)
    data["slots"] = _json_load(data.pop("slots_json", "[]"), [])
    data["stats"] = _json_load(data.pop("stats_json", "{}"), {})
    return data


def get_lab_session(user_id: str, session_id: str) -> dict[str, Any] | None:
    _ensure()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM context_lab_sessions WHERE id = ? AND user_id = ?",
            (session_id, user_id),
        ).fetchone()
    return _session_row(row) if row else None


def list_lab_sessions(user_id: str, project_id: str) -> list[dict[str, Any]]:
    _ensure()
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT * FROM context_lab_sessions
             WHERE user_id = ? AND project_id = ?
             ORDER BY updated_at DESC
             LIMIT 20
            """,
            (user_id, project_id),
        ).fetchall()
    return [_session_row(r) for r in rows]


def create_lab_session(
    user_id: str,
    project_id: str,
    *,
    prompt: str,
    slots: list[dict[str, Any]],
) -> dict[str, Any]:
    _ensure()
    sid = _new_id()
    cleaned = []
    for idx, slot in enumerate((slots or [])[:4]):
        if not isinstance(slot, dict):
            continue
        kind = str(slot.get("kind") or "custom").strip().lower()
        if kind not in {"original", "builtin", "custom", "file"}:
            kind = "custom"
        cleaned.append(
            {
                "index": idx,
                "kind": kind,
                "label": str(slot.get("label") or _slot_label(kind, idx))[:80],
                "instruction_id": str(slot.get("instruction_id") or "")[:40],
                "prompt": str(slot.get("prompt") or "")[:8000],
                "status": "queued",
                "filename": "",
                "url": "",
            }
        )
    if not cleaned:
        cleaned = [{"index": 0, "kind": "original", "label": "No Improve", "instruction_id": "", "prompt": prompt, "status": "queued"}]
    now = _now()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO context_lab_sessions
              (id, user_id, project_id, prompt, slots_json, status, stats_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'queued', '{}', ?, ?)
            """,
            (sid, user_id, project_id, prompt[:8000], json.dumps(cleaned), now, now),
        )
    return get_lab_session(user_id, sid) or {}


def _slot_label(kind: str, index: int) -> str:
    if kind == "original":
        return "No Improve"
    if kind == "builtin":
        return "Studio Improve"
    if kind == "file":
        return f"File instructions {index + 1}"
    return f"Improve {index + 1}"


def update_lab_slot(
    user_id: str,
    session_id: str,
    index: int,
    **fields: Any,
) -> dict[str, Any] | None:
    session = get_lab_session(user_id, session_id)
    if not session:
        return None
    slots = list(session.get("slots") or [])
    if index < 0 or index >= len(slots):
        return session
    slot = dict(slots[index])
    for key in ("status", "prompt", "filename", "url", "error", "trace_id", "notes"):
        if key in fields and fields[key] is not None:
            slot[key] = fields[key]
    slots[index] = slot
    statuses = [str(s.get("status") or "") for s in slots]
    if any(s == "running" for s in statuses):
        status = "running"
    elif statuses and all(s in {"complete", "error"} for s in statuses):
        status = "complete"
    else:
        status = session.get("status") or "queued"
    stats = dict(session.get("stats") or {})
    if "stats" in fields and isinstance(fields["stats"], dict):
        stats.update(fields["stats"])
    now = _now()
    with get_conn() as conn:
        conn.execute(
            """
            UPDATE context_lab_sessions
               SET slots_json=?, status=?, stats_json=?, updated_at=?
             WHERE id=? AND user_id=?
            """,
            (json.dumps(slots), status, json.dumps(stats), now, session_id, user_id),
        )
    return get_lab_session(user_id, session_id)


def record_lab_result(
    project_path: Path,
    session: dict[str, Any],
    *,
    slot_index: int,
    filename: str,
    label: str,
) -> dict[str, Any]:
    """Copy a generated model into Improve Lab without touching the main timeline."""
    sid = session["id"]
    dest_dir = lab_dir(project_path, sid)
    src = Path(project_path) / filename
    if not src.is_file():
        from backend.services.engine_layout import resolve_in_layout

        hit = resolve_in_layout(project_path, filename)
        src = Path(hit) if hit else src
    safe_label = re.sub(r"[^\w.\-]+", "_", label or f"slot-{slot_index}")[:40] or f"slot-{slot_index}"
    dest_name = f"{slot_index:02d}-{safe_label}{src.suffix.lower() or '.glb'}"
    dest = dest_dir / dest_name
    if src.is_file():
        dest.write_bytes(src.read_bytes())
    rel = f"references/{IMPROVE_LAB_DIRNAME}/{sid}/{dest_name}"
    timeline_path = dest_dir / "timeline.json"
    try:
        data = json.loads(timeline_path.read_text(encoding="utf-8")) if timeline_path.is_file() else {"entries": []}
    except Exception:
        data = {"entries": []}
    entries = list(data.get("entries") or [])
    entries.append(
        {
            "index": len(entries),
            "kind": "improve_lab",
            "label": label,
            "filename": rel,
            "slot": slot_index,
            "created_at": _now(),
        }
    )
    timeline_path.write_text(json.dumps({"entries": entries, "current_index": len(entries) - 1}, indent=2), encoding="utf-8")
    return {"filename": rel, "url": rel, "local_name": dest_name}


def drive_redirect_uri() -> str:
    base = (settings.public_base_url or "https://render3d.app").rstrip("/")
    return f"{base}/oauth/drive/callback"


def drive_oauth_start_url(*, user_id: str, state: str) -> str:
    if not settings.google_client_id:
        raise ValueError("Google Drive is not configured")
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": drive_redirect_uri(),
        "response_type": "code",
        "scope": GOOGLE_DRIVE_SCOPES,
        "access_type": "offline",
        "include_granted_scopes": "true",
        "prompt": "consent",
        "state": f"drive:google:{user_id}:{state}",
    }
    return "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params)


def parse_drive_oauth_state(state: str | None) -> str:
    parts = str(state or "").split(":")
    if len(parts) < 4 or parts[0] != "drive":
        raise ValueError("Invalid Drive OAuth state")
    return parts[2]


def drive_status(user_id: str) -> dict[str, Any]:
    _ensure()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT email, scopes, updated_at, access_token FROM context_drive_connections WHERE user_id = ?",
            (user_id,),
        ).fetchone()
    connected = bool(row and row["access_token"])
    return {
        "connected": connected,
        "email": row["email"] if row else None,
        "configured": bool(settings.google_client_id and settings.google_client_secret),
        "updated_at": row["updated_at"] if row else None,
    }


def complete_drive_oauth(*, code: str, state: str) -> dict[str, Any]:
    user_id = parse_drive_oauth_state(state)
    redirect = drive_redirect_uri()
    resp = httpx.post(
        "https://oauth2.googleapis.com/token",
        data={
            "code": code,
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "redirect_uri": redirect,
            "grant_type": "authorization_code",
        },
        timeout=20,
    )
    resp.raise_for_status()
    token = resp.json()
    email = ""
    try:
        info = httpx.get(
            "https://openidconnect.googleapis.com/v1/userinfo",
            headers={"Authorization": f"Bearer {token.get('access_token')}"},
            timeout=15,
        )
        if info.status_code < 400:
            email = str(info.json().get("email") or "")
    except Exception:
        logger.debug("Drive userinfo skipped", exc_info=True)
    _ensure()
    now = _now()
    expires = None
    if token.get("expires_in"):
        try:
            expires = datetime.fromtimestamp(
                datetime.now(timezone.utc).timestamp() + int(token["expires_in"]),
                tz=timezone.utc,
            ).isoformat()
        except Exception:
            expires = None
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO context_drive_connections
              (user_id, access_token, refresh_token, scopes, expires_at, email, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
              access_token=excluded.access_token,
              refresh_token=COALESCE(excluded.refresh_token, context_drive_connections.refresh_token),
              scopes=excluded.scopes,
              expires_at=excluded.expires_at,
              email=excluded.email,
              updated_at=excluded.updated_at
            """,
            (
                user_id,
                token.get("access_token"),
                token.get("refresh_token"),
                token.get("scope") or GOOGLE_DRIVE_SCOPES,
                expires,
                email,
                now,
            ),
        )
    return {"user_id": user_id, "email": email, "connected": True}


def disconnect_drive(user_id: str) -> None:
    _ensure()
    with get_conn() as conn:
        conn.execute("DELETE FROM context_drive_connections WHERE user_id = ?", (user_id,))


def _drive_access_token(user_id: str) -> str:
    _ensure()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT access_token, refresh_token, expires_at FROM context_drive_connections WHERE user_id = ?",
            (user_id,),
        ).fetchone()
    if not row or not row["access_token"]:
        raise LookupError("Google Drive is not connected")
    token = row["access_token"]
    expires_at = str(row["expires_at"] or "")
    try:
        exp = datetime.fromisoformat(expires_at.replace("Z", "+00:00")) if expires_at else None
    except Exception:
        exp = None
    if exp and exp <= datetime.now(timezone.utc) + timedelta(minutes=2):
        if row["refresh_token"] and settings.google_client_id:
            resp = httpx.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
                    "refresh_token": row["refresh_token"],
                    "grant_type": "refresh_token",
                },
                timeout=20,
            )
            if resp.status_code < 400:
                data = resp.json()
                token = data.get("access_token") or token
                with get_conn() as conn:
                    conn.execute(
                        "UPDATE context_drive_connections SET access_token=?, updated_at=? WHERE user_id=?",
                        (token, _now(), user_id),
                    )
    return token


def list_drive_folders(user_id: str, *, parent_id: str | None = None, query: str | None = None) -> list[dict[str, Any]]:
    token = _drive_access_token(user_id)
    q = "mimeType = 'application/vnd.google-apps.folder' and trashed = false"
    if parent_id:
        q += f" and '{parent_id}' in parents"
    elif query:
        safe = str(query).replace("'", " ")[:80]
        q += f" and name contains '{safe}'"
    resp = httpx.get(
        "https://www.googleapis.com/drive/v3/files",
        params={
            "q": q,
            "pageSize": 40,
            "fields": "files(id,name,modifiedTime)",
            "orderBy": "name",
        },
        headers={"Authorization": f"Bearer {token}"},
        timeout=20,
    )
    resp.raise_for_status()
    files = resp.json().get("files") or []
    return [{"id": f.get("id"), "name": f.get("name"), "modified": f.get("modifiedTime")} for f in files]


def fetch_website_text(url: str) -> tuple[str, str]:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("Enter an http(s) website URL")
    resp = httpx.get(
        url,
        timeout=20,
        follow_redirects=True,
        headers={"User-Agent": "RenderStudioKnowledge/1.0"},
    )
    resp.raise_for_status()
    html = resp.text or ""
    title_match = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
    title = unescape(re.sub(r"\s+", " ", title_match.group(1))).strip() if title_match else parsed.netloc
    cleaned = re.sub(r"(?is)<(script|style|noscript|svg)[^>]*>.*?</\1>", " ", html)
    cleaned = re.sub(r"(?is)<[^>]+>", " ", cleaned)
    text = unescape(re.sub(r"\s+", " ", cleaned)).strip()
    if len(text) < 40:
        raise ValueError("That page did not yield usable text")
    return title[:180] or parsed.netloc, text[:80_000]


def add_knowledge_source(
    user_id: str,
    kb_id: str,
    *,
    source_type: str,
    url: str = "",
    drive_folder_id: str = "",
    label: str = "",
) -> dict[str, Any]:
    from backend.services import knowledge_service

    knowledge_service.get_knowledge_base(user_id, kb_id, require_owner=True)
    source_type = str(source_type or "").strip().lower()
    if source_type not in {"website", "drive"}:
        raise ValueError("Source must be website or drive")
    _ensure()
    sid = _new_id()
    now = _now()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO knowledge_sources
              (id, kb_id, source_type, url, drive_folder_id, label, last_synced, extra_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, NULL, '{}', ?)
            """,
            (sid, kb_id, source_type, url[:2000], drive_folder_id[:120], label[:180], now),
        )
    return sync_knowledge_source(user_id, kb_id, sid)


def list_knowledge_sources(user_id: str, kb_id: str) -> list[dict[str, Any]]:
    from backend.services import knowledge_service

    knowledge_service.get_knowledge_base(user_id, kb_id)
    _ensure()
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM knowledge_sources WHERE kb_id = ? ORDER BY created_at DESC",
            (kb_id,),
        ).fetchall()
    return [_row(r) for r in rows]


def delete_knowledge_source(user_id: str, kb_id: str, source_id: str) -> None:
    from backend.services import knowledge_service

    knowledge_service.get_knowledge_base(user_id, kb_id, require_owner=True)
    _ensure()
    with get_conn() as conn:
        conn.execute("DELETE FROM knowledge_sources WHERE id = ? AND kb_id = ?", (source_id, kb_id))


def sync_knowledge_source(user_id: str, kb_id: str, source_id: str) -> dict[str, Any]:
    from backend.services import knowledge_service

    knowledge_service.get_knowledge_base(user_id, kb_id, require_owner=True)
    _ensure()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM knowledge_sources WHERE id = ? AND kb_id = ?",
            (source_id, kb_id),
        ).fetchone()
    if not row:
        raise LookupError("Knowledge source not found")
    source = _row(row)
    imported = 0
    if source["source_type"] == "website":
        title, text = fetch_website_text(source["url"])
        name = f"{title or 'Website'}.md"
        body = f"# {title}\n\nSource: {source['url']}\n\n{text}"
        knowledge_service.add_item_bytes(
            user_id,
            kb_id,
            filename=name,
            data=body.encode("utf-8"),
            media_type="text/markdown",
        )
        imported = 1
        label = title
    else:
        token = _drive_access_token(user_id)
        folder_id = source.get("drive_folder_id") or ""
        if not folder_id:
            raise ValueError("Drive folder id is required")
        resp = httpx.get(
            "https://www.googleapis.com/drive/v3/files",
            params={
                "q": f"'{folder_id}' in parents and trashed = false",
                "pageSize": 30,
                "fields": "files(id,name,mimeType,size)",
            },
            headers={"Authorization": f"Bearer {token}"},
            timeout=25,
        )
        resp.raise_for_status()
        files = resp.json().get("files") or []
        label = source.get("label") or "Drive folder"
        for item in files[:24]:
            mime = str(item.get("mimeType") or "")
            name = str(item.get("name") or "drive-file")
            if mime == "application/vnd.google-apps.folder":
                continue
            export_url = None
            if mime.startswith("application/vnd.google-apps"):
                export_url = f"https://www.googleapis.com/drive/v3/files/{item['id']}/export"
                params = {"mimeType": "text/plain"}
            else:
                export_url = f"https://www.googleapis.com/drive/v3/files/{item['id']}"
                params = {"alt": "media"}
            try:
                file_resp = httpx.get(
                    export_url,
                    params=params,
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=30,
                )
                if file_resp.status_code >= 400:
                    continue
                data = file_resp.content or b""
                if not data:
                    continue
                if not Path(name).suffix:
                    name = f"{name}.txt"
                knowledge_service.add_item_bytes(
                    user_id,
                    kb_id,
                    filename=name,
                    data=data,
                    media_type=mime[:120] or "application/octet-stream",
                )
                imported += 1
            except Exception:
                logger.debug("Drive file import skipped %s", name, exc_info=True)
    now = _now()
    with get_conn() as conn:
        conn.execute(
            "UPDATE knowledge_sources SET last_synced=?, label=? WHERE id=?",
            (now, (label or source.get("label") or "")[:180], source_id),
        )
    source["last_synced"] = now
    source["imported"] = imported
    source["label"] = label
    return source
