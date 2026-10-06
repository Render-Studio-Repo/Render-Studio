"""LAN-only Viser / hand-cam URL helpers. No public SSRF."""

from __future__ import annotations

import ipaddress
import json
import re
import socket
from urllib.parse import urlparse

VISER_TICKET_TTL_SEC = 2 * 60 * 60


def hostname_of(host_or_url: str) -> str:
    raw = str(host_or_url or "").strip()
    if not raw:
        return ""
    try:
        if "://" in raw:
            return str(urlparse(raw).hostname or "").lower()
    except Exception:
        pass
    cut = raw.split("/")[0].split("?")[0].strip("[]")
    if cut.count(":") == 1 and cut.split(":")[1].isdigit():
        return cut.split(":")[0].lower()
    return cut.lower()


def is_private_lan_host(host: str) -> bool:
    h = str(host or "").lower().strip("[]")
    if not h:
        return False
    if h in {"localhost", "127.0.0.1", "::1"}:
        return True
    if h.endswith(".local") and "." in h:
        return True
    try:
        ip = ipaddress.ip_address(h)
    except ValueError:
        return False
    if str(ip) == "169.254.169.254":
        return False
    if ip.is_loopback or ip.is_private or ip.is_link_local:
        return True
    return False


def normalize_viser_url(raw: str) -> str:
    s = str(raw or "").strip()
    if not s:
        return ""
    if s.lower().startswith("ws://"):
        s = f"http://{s[5:]}"
    elif s.lower().startswith("wss://"):
        s = f"http://{s[6:]}"
    elif "://" not in s:
        s = f"http://{s.lstrip('[]')}"
    try:
        parsed = urlparse(s)
    except Exception:
        return ""
    if parsed.scheme not in {"http", "https"}:
        return ""
    host = (parsed.hostname or "").lower()
    if not is_private_lan_host(host):
        return ""
    if host == "169.254.169.254":
        return ""
    # Viser is HTTP. HTTPS Studio cannot iframe http://Pi, and a laptop will
    # not trust a self-signed https://192.168.x.x cert. Always probe/proxy HTTP.
    port = parsed.port or 8095
    path = parsed.path or "/"
    query = f"?{parsed.query}" if parsed.query else ""
    return f"http://{host}:{port}{path}{query}"


def resolve_lan_ip(host: str) -> str:
    h = hostname_of(host)
    if not h:
        return ""
    try:
        ipaddress.ip_address(h)
        return h
    except ValueError:
        pass
    try:
        infos = socket.getaddrinfo(h, None, socket.AF_UNSPEC, socket.SOCK_STREAM)
    except OSError:
        return ""
    for info in infos:
        addr = info[4][0]
        if is_private_lan_host(addr):
            return addr
    return ""


def allow_viser_target(raw: str) -> tuple[str, str, int, str]:
    """Return (normalized_url, host, port, path) or raise ValueError."""
    url = normalize_viser_url(raw)
    if not url:
        raise ValueError("Viser URL must be http(s) on localhost or a private LAN IP")
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    resolved = resolve_lan_ip(host)
    if not resolved and (host.endswith(".local") or host == "localhost"):
        resolved = host
    if not resolved or not is_private_lan_host(resolved):
        raise ValueError("Viser host did not resolve to a private LAN address")
    port = parsed.port or 8095
    if port < 1 or port > 65535:
        raise ValueError("Invalid Viser port")
    path = parsed.path or "/"
    if parsed.query:
        path = f"{path}?{parsed.query}"
    return url, host, int(port), path


def probe_viser(url: str) -> tuple[bool, str]:
    """Best-effort ping from this Studio process (Mac Mini), not the laptop browser.

    Never raises. Studio still issues a proxy ticket either way so the same-origin
    iframe can try HTTP even when the user pasted https://.
    """
    try:
        import httpx
    except Exception:
        return True, ""
    target = normalize_viser_url(url) or url
    try:
        with httpx.Client(
            timeout=httpx.Timeout(3.0, connect=2.0),
            follow_redirects=True,
            verify=False,
        ) as client:
            response = client.get(target)
        if int(response.status_code) >= 500:
            return False, f"Can't reach Viser at {target}. Start Viser locally or enter a LAN address."
        return True, ""
    except Exception:
        return False, f"Can't reach Viser at {target}. Start Viser locally or enter a LAN address."


_ABS_ATTR = re.compile(r"""(?P<pre>\b(?:src|href|action)\s*=\s*["'])/(?!/)""", re.IGNORECASE)


def rewrite_viser_html(html: str, prefix: str, upstream_host: str = "") -> str:
    """Serve Viser under /api/viser/p/<host>/<port>/ so HTTPS Studio is same-origin."""
    return rewrite_proxied_html(html, prefix, upstream_host, "/api/viser/p/")


def rewrite_proxied_html(
    html: str,
    prefix: str,
    upstream_host: str = "",
    api_marker: str = "/api/viser/p/",
    extra_script: str = "",
) -> str:
    """Serve a LAN app under /api/<kind>/p/<host>/<port>/ so HTTPS Studio is same-origin."""
    prefix = prefix if str(prefix).endswith("/") else f"{prefix}/"
    patched = _ABS_ATTR.sub(rf"\g<pre>{prefix}", html)
    inject = _proxy_inject_script(prefix, upstream_host, api_marker) + (extra_script or "")
    base = f'<base href="{prefix}">'
    lower = patched.lower()
    head = lower.find("<head")
    if head >= 0:
        gt = patched.find(">", head)
        if gt >= 0:
            return f"{patched[: gt + 1]}{base}{inject}{patched[gt + 1 :]}"
    return f"{base}{inject}{patched}"


def _proxy_inject_script(prefix: str, upstream_host: str, api_marker: str = "/api/viser/p/") -> str:
    payload = json.dumps(
        {
            "prefix": prefix,
            "upstream": str(upstream_host or "").lower(),
            "marker": str(api_marker or "/api/viser/p/"),
        }
    )
    return (
        "<script>(function(){"
        f"var cfg={payload};"
        "var prefix=cfg.prefix;"
        "var marker=String(cfg.marker||'/api/viser/p/');"
        "var upstream=String(cfg.upstream||'').toLowerCase();"
        "function isLan(h){"
        "h=String(h||'').toLowerCase();"
        "if(!h)return false;"
        "if(h===upstream||h==='localhost'||h==='127.0.0.1'||h==='::1')return true;"
        "if(h===location.hostname)return true;"
        "if(/\\.local$/.test(h))return true;"
        "return /^(10\\.|192\\.168\\.|172\\.(1[6-9]|2\\d|3[01])\\.)/.test(h);"
        "}"
        "function rewriteUrl(raw){"
        "try{"
        "var u=new URL(String(raw),location.href);"
        "var path=u.pathname||'/';"
        "if(path.indexOf(marker)===0)return u.href;"
        "var ws=u.protocol==='ws:'||u.protocol==='wss:';"
        "var http=u.protocol==='http:'||u.protocol==='https:';"
        "if(!ws&&!http)return raw;"
        "if(!isLan(u.hostname))return raw;"
        "u.protocol=ws?(location.protocol==='https:'?'wss:':'ws:'):location.protocol;"
        "u.host=location.host;"
        "u.pathname=prefix.replace(/\\/$/,'')+(path==='/'?'/':path);"
        "return u.toString();"
        "}catch(e){}"
        "return raw;"
        "}"
        "var WS=window.WebSocket;"
        "function Wrap(url,protocols){"
        "var next=rewriteUrl(url);"
        "return protocols===undefined?new WS(next):new WS(next,protocols);"
        "}"
        "Wrap.prototype=WS.prototype;"
        "Wrap.CONNECTING=WS.CONNECTING;Wrap.OPEN=WS.OPEN;Wrap.CLOSING=WS.CLOSING;Wrap.CLOSED=WS.CLOSED;"
        "window.WebSocket=Wrap;"
        "var ofetch=window.fetch;"
        "if(ofetch){window.fetch=function(input,init){"
        "if(typeof input==='string')return ofetch(rewriteUrl(input),init);"
        "if(input&&typeof input.url==='string'){"
        "var next=rewriteUrl(input.url);"
        "if(next!==input.url){try{input=new Request(next,input);}catch(e){}}"
        "}"
        "return ofetch(input,init);"
        "};}"
        "})();</script>"
    )


def normalize_camera_host(raw: str) -> str:
    s = str(raw or "").strip()
    if not s:
        return ""
    url = normalize_viser_url(s if "://" in s or ":" in s else f"http://{s}:8001/")
    if not url:
        return ""
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    port = parsed.port or 8001
    return host if port == 8001 else f"{host}:{port}"
