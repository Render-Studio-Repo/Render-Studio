"""LAN Bambu bind + throw-to-print start. Never logs access codes or PINs."""

from __future__ import annotations

import logging
from argparse import Namespace
from pathlib import Path
from typing import Any

logger = logging.getLogger("render3d.bambu_print")


def _printer_secrets(user_id: str = "") -> dict[str, str]:
    from backend.services.social_network_service import apply_env_printer_defaults, get_printer_share_settings

    row = apply_env_printer_defaults(get_printer_share_settings(user_id) if user_id else {})
    return {
        "lan_ip": str(row.get("lan_ip") or "").strip(),
        "access_code": str(row.get("access_code") or "").strip(),
        "serial": str(row.get("serial") or "").strip(),
        "name": str(row.get("name") or "").strip(),
    }


def printer_is_bound(user_id: str = "") -> bool:
    secrets = _printer_secrets(user_id)
    return bool(secrets["lan_ip"] and secrets["access_code"])


def bind_local_printer(user_id: str = "") -> dict[str, Any]:
    """MQTT CONNACK only. Never starts a print. Never logs the PIN."""
    from backend.services.bambu_printer_bind import mqtt_bind_host

    secrets = _printer_secrets(user_id)
    host = secrets["lan_ip"]
    pin = secrets["access_code"]
    if not host or not pin:
        return {"ok": False, "bound": False, "message": "Printer LAN host or bind code is not set."}
    try:
        result = mqtt_bind_host(host, pin)
    except (OSError, ValueError, TimeoutError) as exc:
        logger.info("bambu bind failed for host %s: %s", host, type(exc).__name__)
        return {"ok": False, "bound": False, "host": host, "message": "Printer did not accept the LAN bind."}
    serial = str(result.get("serial") or secrets["serial"] or "")
    if user_id and (serial or host):
        from backend.services.social_network_service import save_printer_share_settings

        save_printer_share_settings(user_id, lan_ip=host, serial=serial or None, show_outline=True)
    return {
        "ok": True,
        "bound": True,
        "host": host,
        "serial": serial,
        "message": "Printer bound on LAN.",
    }


def _three_mf_for_model(project_path: Path, filename: str, *, filament: str, supports_enabled: bool) -> Path:
    from backend.services import cad_service

    safe = cad_service.resolve_existing_project_file(project_path, filename)
    if not safe:
        raise ValueError("Model file not found")
    cad_service.ensure_mesh_exports(project_path, safe)
    exports = cad_service.list_exports_for_model(project_path, safe)
    three = next((item for item in exports if str(item.get("format") or "").lower() == "3mf"), None)
    dest = None
    if not three:
        dest = cad_service.convert_mesh_to_3mf(project_path, safe)
        exports = cad_service.list_exports_for_model(project_path, safe)
        three = next((item for item in exports if str(item.get("format") or "").lower() == "3mf"), None)
    three_path = None
    if three and three.get("name"):
        three_path = cad_service.resolve_existing_project_file(project_path, three["name"])
    path = Path(three_path or dest or "")
    if not path.is_file():
        raise ValueError("Could not prepare a 3MF for this model")
    cad_service.apply_print_profile_to_3mf(path, {"filament": filament, "supports_enabled": supports_enabled})
    return path


def _lan_args(secrets: dict[str, str]) -> Namespace:
    return Namespace(
        host=secrets["lan_ip"],
        access_code=secrets["access_code"],
        serial=secrets["serial"],
        printer="",
        config="",
        ftps_port=990,
        mqtt_port=8883,
        timeout=12.0,
        tls_verify=False,
        allow_nonprivate_host=False,
        client_id="",
        mqtt_qos=0,
        wait_after_publish=0.0,
        sequence_id=0,
        execute=True,
        confirm_start_print=True,
        action="upload-start",
        handoff="plain",
    )


def _load_lan_print():
    import importlib.util

    path = Path(__file__).resolve().parents[1] / "skills" / "bambu-labs" / "scripts" / "bambu_lan_print.py"
    spec = importlib.util.spec_from_file_location("bambu_lan_print_runtime", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Bambu LAN helper is missing")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _attempt_lan_start(secrets: dict[str, str], three_mf: Path) -> dict[str, Any]:
    lan = _load_lan_print()

    args = _lan_args(secrets)
    remote = f"/models/{three_mf.name}"
    uploaded = False
    started = False
    try:
        lan.upload_ftps(args, three_mf, remote)
        uploaded = True
    except Exception as exc:
        logger.info("bambu FTPS upload skipped: %s", type(exc).__name__)
        return {"uploaded": False, "started": False, "message": "Printer is bound. 3MF is ready; LAN upload did not complete."}
    serial = secrets["serial"]
    if not serial:
        return {"uploaded": True, "started": False, "message": "3MF uploaded. Add the printer serial to start from LAN."}
    try:
        payload = {
            "print": {
                "sequence_id": "0",
                "command": "project_file",
                "param": f"Metadata/plate_1.gcode",
                "url": f"ftp://{args.host}{remote}",
                "subtask_name": three_mf.stem[:40],
                "timelapse": False,
                "bed_type": "auto",
                "use_ams": False,
            }
        }
        lan.publish_mqtt(args, f"device/{serial}/request", payload)
        started = True
    except Exception as exc:
        logger.info("bambu MQTT start skipped: %s", type(exc).__name__)
        return {"uploaded": True, "started": False, "message": "3MF uploaded. Printer did not accept the start command."}
    return {"uploaded": uploaded, "started": started, "message": "Start request sent to the printer."}


def start_throw_print(
    user_id: str,
    *,
    project_path: Path,
    filename: str,
    filament: str = "PETG",
    supports_enabled: bool = False,
) -> dict[str, Any]:
    fil = "PLA" if str(filament or "").strip().upper() == "PLA" else "PETG"
    three_mf = _three_mf_for_model(project_path, filename, filament=fil, supports_enabled=bool(supports_enabled))
    bind = bind_local_printer(user_id)
    if not bind.get("bound"):
        return {
            "ok": True,
            "bound": False,
            "started": False,
            "prepared": True,
            "filename": three_mf.name,
            "filament": fil,
            "supports_enabled": bool(supports_enabled),
            "message": bind.get("message") or "3MF prepared. Bind the printer to start on LAN.",
        }
    lan = _attempt_lan_start(_printer_secrets(user_id), three_mf)
    return {
        "ok": True,
        "bound": True,
        "started": bool(lan.get("started")),
        "prepared": True,
        "uploaded": bool(lan.get("uploaded")),
        "filename": three_mf.name,
        "filament": fil,
        "supports_enabled": bool(supports_enabled),
        "message": lan.get("message") or "Print prepared.",
    }
