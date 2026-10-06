"""Bind a Bambu printer with the PIN / access code from the printer or Studio Device LAN."""

from __future__ import annotations

import logging
import socket
import ssl
import tempfile
import time
from pathlib import Path
from typing import Any

from backend.services.viser_proxy import hostname_of, is_private_lan_host

logger = logging.getLogger("render3d.bambu_bind")

BAMBU_USERNAME = "bblp"
MQTT_PORT = 8883
SSDP_ADDR = "239.255.255.250"
SSDP_PORT = 2021
SSDP_ST = "urn:bambulab-com:device:3dprinter:1"


def clean_pin(raw: str | None) -> str:
    pin = str(raw or "").strip()
    if not pin:
        raise ValueError(
            "Enter the PIN / bind code from the printer screen or Bambu Studio → Device → Bind with PIN code."
        )
    if set(pin) == {"0"}:
        raise ValueError("That PIN is all zeros. Refresh it on the printer Network / LAN screen, then try again.")
    return pin[:32]


def clean_optional_host(raw: str | None) -> str:
    host = str(raw or "").strip()
    if not host:
        return ""
    parsed = hostname_of(host) or host.split("/")[0].split(":")[0].strip()
    if not is_private_lan_host(parsed):
        raise ValueError("Optional printer IP must be a LAN address from the printer Network screen.")
    return parsed[:255]


def _mqtt_connect_packet(client_id: str, username: str, password: str) -> bytes:
    def _str(value: str) -> bytes:
        data = value.encode("utf-8")
        return len(data).to_bytes(2, "big") + data

    variable = _str("MQTT") + bytes([4, 0xC2]) + (30).to_bytes(2, "big")
    payload = _str(client_id) + _str(username) + _str(password)
    remaining = variable + payload
    length = bytearray()
    n = len(remaining)
    while True:
        digit = n % 128
        n //= 128
        if n:
            digit |= 128
        length.append(digit)
        if not n:
            break
    return bytes([0x10]) + bytes(length) + remaining


def _serial_from_cert(der_cert: bytes) -> str:
    pem = ssl.DER_cert_to_PEM_cert(der_cert)
    temp_path = ""
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".pem", delete=False) as handle:
            temp_path = handle.name
            handle.write(pem)
        decoded = ssl._ssl._test_decode_cert(temp_path)  # type: ignore[attr-defined]
    except Exception:
        return ""
    finally:
        if temp_path:
            try:
                Path(temp_path).unlink()
            except FileNotFoundError:
                pass
    subject = decoded.get("subject") if isinstance(decoded, dict) else None
    if not isinstance(subject, tuple):
        return ""
    for rdn in subject:
        for key, value in rdn:
            if str(key).lower() in {"commonname", "common name"} and str(value).strip():
                return str(value).strip()[:40]
    return ""


def mqtt_bind_host(host: str, pin: str, *, timeout: float = 4.0) -> dict[str, Any]:
    """Read-only MQTT CONNACK. Never starts a print."""
    if not is_private_lan_host(host):
        raise ValueError("Printer host must be on your LAN.")
    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    serial = ""
    with socket.create_connection((host, MQTT_PORT), timeout=timeout) as raw_sock:
        with context.wrap_socket(raw_sock, server_hostname=host) as sock:
            try:
                der = sock.getpeercert(binary_form=True)
                if der:
                    serial = _serial_from_cert(der)
            except Exception:
                serial = ""
            sock.sendall(_mqtt_connect_packet(f"rs-bind-{int(time.time())}", BAMBU_USERNAME, pin))
            header = sock.recv(4)
            if len(header) < 4 or header[0] != 0x20 or header[3] != 0:
                raise ValueError("PIN was not accepted by the printer. Check Bind with PIN code on the printer screen.")
            try:
                sock.sendall(bytes([0xE0, 0x00]))
            except OSError:
                pass
    return {"host": host, "serial": serial}


def ssdp_discover(*, timeout: float = 2.4) -> list[dict[str, str]]:
    payload = (
        "M-SEARCH * HTTP/1.1\r\n"
        f"HOST: {SSDP_ADDR}:{SSDP_PORT}\r\n"
        'MAN: "ssdp:discover"\r\n'
        "MX: 2\r\n"
        f"ST: {SSDP_ST}\r\n"
        "\r\n"
    ).encode("ascii")
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    found: list[dict[str, str]] = []
    seen: set[str] = set()
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        sock.settimeout(timeout)
        sock.sendto(payload, (SSDP_ADDR, SSDP_PORT))
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                data, addr = sock.recvfrom(4096)
            except TimeoutError:
                break
            except OSError:
                break
            text = data.decode("utf-8", errors="replace")
            headers: dict[str, str] = {}
            for line in text.splitlines()[1:]:
                if ":" not in line:
                    continue
                key, value = line.split(":", 1)
                headers[key.strip().lower()] = value.strip()
            host = hostname_of(headers.get("location") or "") or (addr[0] if addr else "")
            if not host or not is_private_lan_host(host) or host in seen:
                continue
            seen.add(host)
            serial = ""
            usn = headers.get("usn") or headers.get("serial") or ""
            if usn:
                serial = usn.split(":")[-1].strip()[:40]
            found.append({
                "host": host,
                "serial": serial,
                "name": headers.get("devname.bambu.com") or headers.get("friendlyname.bambu.com") or "",
            })
    finally:
        sock.close()
    return found


def bind_with_pin(
    *,
    pin: str,
    serial: str = "",
    lan_ip: str = "",
    name: str = "",
    discover: bool = True,
) -> dict[str, Any]:
    """Store a PIN bind. Discover LAN host when possible. Never logs the PIN."""
    code = clean_pin(pin)
    host = clean_optional_host(lan_ip)
    wanted_serial = str(serial or "").strip()[:40]
    label = str(name or "").strip()[:80]
    candidates: list[dict[str, str]] = []
    if host:
        candidates.append({"host": host, "serial": wanted_serial, "name": label})
    elif discover:
        try:
            candidates = ssdp_discover()
        except OSError as exc:
            logger.info("bambu SSDP discover skipped: %s", exc)
            candidates = []
        if wanted_serial:
            match = [c for c in candidates if c.get("serial") == wanted_serial]
            if match:
                candidates = match
    bound: dict[str, Any] | None = None
    last_error = ""
    for row in candidates[:8]:
        try:
            result = mqtt_bind_host(row["host"], code)
        except (OSError, ValueError, TimeoutError) as exc:
            last_error = str(exc)
            continue
        bound = {
            "lan_ip": result["host"],
            "serial": wanted_serial or result.get("serial") or row.get("serial") or "",
            "name": label or row.get("name") or "",
            "reachable": True,
        }
        break
    if bound:
        bound_id = bound["serial"] or bound["lan_ip"] or "pin-bound"
        return {
            "ok": True,
            "bound": True,
            "bound_id": bound_id,
            "lan_ip": bound["lan_ip"],
            "serial": bound["serial"],
            "name": bound["name"],
            "message": "Printer bound. The volume is in the VR scene.",
        }
    return {
        "ok": True,
        "bound": False,
        "bound_id": wanted_serial or "pin-bound",
        "lan_ip": host,
        "serial": wanted_serial,
        "name": label,
        "message": last_error
        or "PIN saved. Open Bind with PIN on the printer, stay on the same Wi-Fi, or add the LAN IP under Advanced.",
    }
