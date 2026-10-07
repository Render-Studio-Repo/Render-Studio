"""LAN-only OpenArm Quest Teleop URL helpers + HTML rewrite. No public SSRF."""

from __future__ import annotations

from urllib.parse import urlparse

from backend.services.viser_proxy import (
    is_private_lan_host,
    resolve_lan_ip,
    rewrite_proxied_html,
)

TELEOP_TICKET_TTL_SEC = 2 * 60 * 60
TELEOP_DEFAULT_PORT = 8443
TELEOP_DEFAULT_PATH = "/teleop"
SAM_TELEOP_EXAMPLE = "https://192.168.1.77:8443/teleop"


def normalize_teleop_url(raw: str, *, keep_path: bool = False) -> str:
    """Force https://host:8443/teleop on a private LAN host (DIMOS is HTTPS)."""
    s = str(raw or "").strip()
    if not s:
        return ""
    if s.lower().startswith("ws://"):
        s = f"https://{s[5:]}"
    elif s.lower().startswith("wss://"):
        s = f"https://{s[6:]}"
    elif "://" not in s:
        s = f"https://{s.lstrip('[]')}"
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
    port = parsed.port or TELEOP_DEFAULT_PORT
    path = parsed.path or TELEOP_DEFAULT_PATH
    if path in {"", "/"}:
        path = TELEOP_DEFAULT_PATH
    elif path.rstrip("/") == "/ws" and not keep_path:
        path = TELEOP_DEFAULT_PATH
    query = f"?{parsed.query}" if parsed.query else ""
    return f"https://{host}:{int(port)}{path}{query}"


def allow_teleop_target(raw: str, *, keep_path: bool = False) -> tuple[str, str, int, str]:
    """Return (normalized_url, host, port, path) or raise ValueError."""
    url = normalize_teleop_url(raw, keep_path=keep_path)
    if not url:
        raise ValueError("Teleop URL must be https on localhost or a private LAN IP")
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    resolved = resolve_lan_ip(host)
    if not resolved and (host.endswith(".local") or host == "localhost"):
        resolved = host
    if not resolved or not is_private_lan_host(resolved):
        raise ValueError("Teleop host did not resolve to a private LAN address")
    port = parsed.port or TELEOP_DEFAULT_PORT
    if port < 1 or port > 65535:
        raise ValueError("Invalid teleop port")
    path = parsed.path or TELEOP_DEFAULT_PATH
    if parsed.query:
        path = f"{path}?{parsed.query}"
    return url, host, int(port), path


def probe_teleop(url: str) -> tuple[bool, str]:
    """Best-effort ping from this Studio process. Never raises."""
    try:
        import httpx
    except Exception:
        return True, ""
    target = normalize_teleop_url(url) or url
    try:
        with httpx.Client(
            timeout=httpx.Timeout(3.0, connect=2.0),
            follow_redirects=True,
            verify=False,
        ) as client:
            response = client.get(target)
        if int(response.status_code) >= 500:
            return False, (
                f"Can't reach Teleop at {target}. Start DIMOS teleop-quest-openarm "
                "on 0.0.0.0:8443 or enter a LAN address."
            )
        return True, ""
    except Exception:
        return False, (
            f"Can't reach Teleop at {target}. Start DIMOS teleop-quest-openarm "
            "on 0.0.0.0:8443 or enter a LAN address."
        )


_AUTO_CONNECT_SCRIPT = (
    "<script>(function(){"
    "function isQuest(){"
    "try{"
    "if(document.documentElement.classList.contains('vr-headset-browser'))return true;"
    "if(window.parent&&window.parent!==window){"
    "var d=window.parent.document;if(d&&d.documentElement.classList.contains('vr-headset-browser'))return true;"
    "}"
    "}catch(e){}"
    "var ua=String(navigator.userAgent||'');"
    "return /OculusBrowser|Quest|PicoBrowser|Helio/i.test(ua);"
    "}"
    "function clickConnect(){"
    "var nodes=document.querySelectorAll('button,a,input[type=button],input[type=submit],[role=button]');"
    "for(var i=0;i<nodes.length;i++){"
    "var el=nodes[i];"
    "var t=String(el.textContent||el.value||el.getAttribute('aria-label')||'').replace(/\\s+/g,' ').trim();"
    "if(!/connect/i.test(t))continue;"
    "if(el.disabled)continue;"
    "try{el.click();return true;}catch(e){}"
    "}"
    "return false;"
    "}"
    "function run(){if(!isQuest())return;clickConnect();}"
    "window.addEventListener('message',function(ev){"
    "var d=ev&&ev.data;if(d&&d.type==='studio-teleop-autoconnect')run();"
    "});"
    "function start(){"
    "run();"
    "var n=0;var iv=setInterval(function(){n++;if(clickConnect()||n>24)clearInterval(iv);},400);"
    "}"
    "if(document.readyState==='complete')start();"
    "else window.addEventListener('load',start);"
    "})();</script>"
)


def rewrite_teleop_html(html: str, prefix: str, upstream_host: str = "") -> str:
    """Same-origin teleop page + Quest auto-click Connect."""
    return rewrite_proxied_html(
        html,
        prefix,
        upstream_host,
        "/api/teleop/p/",
        _AUTO_CONNECT_SCRIPT,
    )
