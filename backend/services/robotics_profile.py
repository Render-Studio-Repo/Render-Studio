"""Bounded, read-only LAN discovery. Profiles describe controls; never execute them."""
import json
import ipaddress
from urllib.parse import urlsplit
import httpx
from backend.services.viser_proxy import is_private_lan_host

MAX_PROFILE_BYTES = 65536


def validate_profile_selection(value):
    if not isinstance(value, dict):
        raise ValueError("Invalid robotics profile")
    if value.get("mode") == "studio":
        return {"mode": "studio"}
    profile = value.get("profile")
    if not isinstance(profile, dict) or profile.get("schema") != "render-studio-robotics/v1":
        raise ValueError("Expected render-studio-robotics/v1 profile")
    if len(json.dumps(value).encode()) > MAX_PROFILE_BYTES:
        raise ValueError("Robotics profile exceeds 64 KB")
    return {"mode": "external" if value.get("mode") == "external" else "integrated", "version": 2, "profile": profile, "configUrl": str(value.get("configUrl") or profile.get("paste_url") or "")[:2048]}


async def discover_profile(url):
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or parsed.username or parsed.password:
        raise ValueError("Use an HTTP(S) LAN URL without credentials")
    host = parsed.hostname or ""
    try:
        ipaddress.ip_address(host)
    except ValueError:
        raise ValueError("Use the Pi's LAN IP address")
    if not is_private_lan_host(host) or host == "169.254.169.254":
        raise ValueError("Discovery is restricted to the local network")
    if parsed.path.rstrip("/") not in {"/robotics/config", "/config"}:
        raise ValueError("Use the LAN /robotics/config or /config endpoint")
    # Validation restricts to explicit loopback/RFC1918 IPs; redirects
    # stay disabled so a discovery response cannot redirect to another service.
    async with httpx.AsyncClient(timeout=6, verify=False, follow_redirects=False, trust_env=False) as client:
        async with client.stream("GET", url, headers={"Accept": "application/json"}) as response:
            response.raise_for_status()
            body = bytearray()
            async for chunk in response.aiter_bytes():
                body.extend(chunk)
                if len(body) > MAX_PROFILE_BYTES:
                    raise ValueError("Robotics profile exceeds 64 KB")
    profile = json.loads(body)
    return validate_profile_selection({"profile": profile, "configUrl": url})

