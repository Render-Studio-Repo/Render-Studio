"""Bounded, public-page previews. Page content is data, never AI instructions."""
from __future__ import annotations

import json
import http.client
import ipaddress
import re
import socket
import time
import urllib.parse
import urllib.request
from collections import OrderedDict
from html.parser import HTMLParser
from threading import RLock

from backend.services.url_document_service import _is_blocked_host, _BROWSER_UA, amazon_asin

_cache = OrderedDict()
_lock = RLock()


def public_url(value, base=""):
    try:
        url = urllib.parse.urljoin(base, str(value or "").strip())
        p = urllib.parse.urlsplit(url)
        if len(url) > 4000 or p.scheme not in {"http", "https"} or p.username or p.password:
            return ""
        if p.port not in {None, 80, 443} or _is_blocked_host(p.hostname):
            return ""
        return url
    except ValueError:
        return ""


class PublicRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        safe = public_url(newurl, req.full_url)
        if not safe:
            raise ValueError("Blocked redirect")
        return super().redirect_request(req, fp, code, msg, headers, safe)


def public_socket(host, port, timeout, source_address=None):
    # Pin the connection to an address we inspected. A second hostname lookup
    # between validation and connect would otherwise permit DNS rebinding.
    addresses = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(info[4][0]).is_global for info in addresses):
        raise ValueError("Blocked network address")
    last_error = None
    for info in addresses:
        try:
            return socket.create_connection((info[4][0], port), timeout, source_address)
        except OSError as error:
            last_error = error
    raise last_error or OSError("No public address available")


class PublicHTTPConnection(http.client.HTTPConnection):
    def connect(self):
        self.sock = public_socket(self.host, self.port, self.timeout, self.source_address)


class PublicHTTPSConnection(http.client.HTTPSConnection):
    def connect(self):
        sock = public_socket(self.host, self.port, self.timeout, self.source_address)
        try:
            self.sock = self._context.wrap_socket(sock, server_hostname=self.host)
        except Exception:
            sock.close()
            raise


class PublicHTTPHandler(urllib.request.HTTPHandler):
    def http_open(self, req):
        return self.do_open(PublicHTTPConnection, req)


class PublicHTTPSHandler(urllib.request.HTTPSHandler):
    def https_open(self, req):
        return self.do_open(PublicHTTPSConnection, req, context=self._context, check_hostname=self._check_hostname)


def public_opener():
    return urllib.request.build_opener(urllib.request.ProxyHandler({}), PublicRedirect(), PublicHTTPHandler(), PublicHTTPSHandler())


def fetch_public(url, *, max_bytes=600_000, accept="text/html", timeout=8):
    safe = public_url(url)
    if not safe:
        raise ValueError("Use a public HTTP or HTTPS link")
    request = urllib.request.Request(safe, headers={"User-Agent": _BROWSER_UA, "Accept": accept})
    # Disable environment proxies and validate every redirect before connecting.
    opener = public_opener()
    with opener.open(request, timeout=timeout) as response:
        raw = response.read(max_bytes + 1)
        if len(raw) > max_bytes:
            raw = raw[:max_bytes]
        return raw, response.headers.get("Content-Type", ""), response.geturl()


class Metadata(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.meta, self.title, self.product_title, self.jsonld = {}, [], [], []
        self.in_title = False
        self.in_product = False
        self.in_json = False
        self.icon = ""

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "meta":
            self.meta[(a.get("property") or a.get("name") or "").lower()] = a.get("content", "")
        if tag == "title": self.in_title = True
        if a.get("id") == "productTitle": self.in_product = True
        if tag == "script" and a.get("type") == "application/ld+json": self.in_json = True
        if tag == "link" and "icon" in a.get("rel", "").lower(): self.icon = a.get("href", "")
        if tag == "img" and a.get("id") == "landingImage":
            self.meta.setdefault("og:image", a.get("data-old-hires") or a.get("src", ""))

    def handle_endtag(self, tag):
        if tag == "title": self.in_title = False
        if tag == "span": self.in_product = False
        if tag == "script": self.in_json = False

    def handle_data(self, data):
        if self.in_title: self.title.append(data)
        if self.in_product: self.product_title.append(data)
        if self.in_json and sum(map(len, self.jsonld)) < 80_000: self.jsonld.append(data)


def parse_preview(html, url):
    parser = Metadata()
    parser.feed(html)
    product = {}
    for block in parser.jsonld:
        try:
            raw = json.loads(block)
            items = raw if isinstance(raw, list) else [raw, *(raw.get("@graph", []) if isinstance(raw, dict) else [])]
            for item in items:
                if isinstance(item, dict) and "Product" in str(item.get("@type", "")):
                    product = item
                    break
        except (ValueError, TypeError):
            pass
    title = " ".join(parser.product_title) or parser.meta.get("og:title") or product.get("name") or " ".join(parser.title)
    description = parser.meta.get("og:description") or parser.meta.get("description") or product.get("description") or ""
    photo = parser.meta.get("og:image") or parser.meta.get("twitter:image") or product.get("image") or ""
    if isinstance(photo, list): photo = photo[0] if photo else ""
    if isinstance(photo, dict): photo = photo.get("url", "")
    return {"title": re.sub(r"\s+", " ", str(title)).strip()[:500],
            "description": re.sub(r"\s+", " ", str(description)).strip()[:1200],
            "image": public_url(photo, url) if photo else "",
            "favicon": public_url(parser.icon or "/favicon.ico", url)}


def preview(url):
    safe = public_url(url)
    if not safe:
        raise ValueError("Use a public HTTP or HTTPS link")
    with _lock:
        cached = _cache.get(safe)
        if cached and time.monotonic() - cached[0] < 1800:
            return dict(cached[1])
    host = urllib.parse.urlsplit(safe).hostname
    asin = amazon_asin(safe) if re.search(r"(^|\.)amazon\.[a-z.]+$", host or "") else ""
    result = {"url": safe, "site": host, "title": f"Amazon · {asin}" if asin else host,
              "description": "Preview unavailable. Open the website to see the full product details.",
              "image": "", "favicon": public_url("/favicon.ico", safe), "available": False}
    try:
        raw, kind, final = fetch_public(safe)
        if "html" in kind:
            details = parse_preview(raw.decode("utf-8", errors="replace"), final)
            if details["title"] and not re.search(r"captcha|robot check|access denied|just a moment|amazon\.com\s*$", details["title"], re.I):
                result.update(details, available=True)
    except Exception:
        pass  # A link still works when its website refuses previews.
    with _lock:
        _cache[safe] = (time.monotonic(), result)
        _cache.move_to_end(safe)
        while len(_cache) > 256: _cache.popitem(last=False)
    return dict(result)
