"""Fetch public product pages / datasheet PDFs and extract text for AI prompts."""

from __future__ import annotations

import hashlib
import io
import ipaddress
import json
import re
import socket
import urllib.error
import urllib.parse
import urllib.request
from html import unescape
from typing import Any

URL_RE = re.compile(r"https?://[^\s<>\]\)\"']+", re.I)
AMAZON_ASIN_RE = re.compile(r"(?:/dp/|/gp/product/|/gp/aw/d/|/product/)([A-Z0-9]{10})", re.I)
AMAZON_HOST_RE = re.compile(r"(?:^|\.)amazon\.[a-z.]+$", re.I)
MAX_URLS = 4
MAX_DOWNLOAD_BYTES = 8_000_000
MAX_TEXT_CHARS = 24_000
FETCH_TIMEOUT_SEC = 20
_BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)


def _is_blocked_host(hostname: str | None) -> bool:
    host = (hostname or "").strip().strip("[]").lower()
    if not host:
        return True
    if host in {"localhost", "metadata.google.internal"} or host.endswith(".local"):
        return True
    try:
        ip = ipaddress.ip_address(host)
        return (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
        )
    except ValueError:
        pass
    try:
        infos = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except Exception:
        return True
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except Exception:
            return True
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
        ):
            return True
    return False


def amazon_asin(url: str | None) -> str:
    raw = str(url or "").strip()
    if not raw:
        return ""
    try:
        parsed = urllib.parse.urlparse(raw)
    except ValueError:
        return ""
    match = AMAZON_ASIN_RE.search(parsed.path or "")
    if match:
        return match.group(1).upper()
    qs = urllib.parse.parse_qs(parsed.query or "")
    for key in ("asin", "ASIN"):
        vals = qs.get(key) or []
        if vals and re.fullmatch(r"[A-Z0-9]{10}", str(vals[0] or ""), re.I):
            return str(vals[0]).upper()
    return ""


def _is_amazon_host(hostname: str | None) -> bool:
    return bool(AMAZON_HOST_RE.search(str(hostname or "").strip().lower()))


def clean_url(url: str | None) -> str | None:
    raw = (url or "").strip().rstrip(".,;:!?)\"]'")
    if not raw:
        return None
    try:
        parsed = urllib.parse.urlparse(raw)
    except ValueError:
        return None
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password:
        return None
    if _is_blocked_host(parsed.hostname):
        return None
    asin = amazon_asin(raw)
    if asin and _is_amazon_host(parsed.hostname):
        return urllib.parse.urlunparse((parsed.scheme, parsed.netloc, f"/dp/{asin}", "", "", ""))
    return urllib.parse.urlunparse(
        (parsed.scheme, parsed.netloc, parsed.path, "", parsed.query, "")
    )


def urls_from_text(text: str, *, limit: int = MAX_URLS) -> list[str]:
    found: list[str] = []
    for match in URL_RE.findall(text or ""):
        clean = clean_url(match)
        if clean and clean not in found:
            found.append(clean)
        if len(found) >= limit:
            break
    return found


def _collapse_ws(text: str) -> str:
    return re.sub(r"[ \t\f\v]+", " ", re.sub(r"\n{3,}", "\n\n", text or "")).strip()


def _extract_pdf_text(data: bytes) -> str:
    try:
        from pypdf import PdfReader  # type: ignore

        reader = PdfReader(io.BytesIO(data))
        chunks: list[str] = []
        for page in reader.pages[:40]:
            chunks.append(page.extract_text() or "")
            if sum(len(c) for c in chunks) > MAX_TEXT_CHARS:
                break
        return _collapse_ws("\n".join(chunks))[:MAX_TEXT_CHARS]
    except Exception:
        try:
            import PyPDF2  # type: ignore

            reader = PyPDF2.PdfReader(io.BytesIO(data))
            chunks = [(page.extract_text() or "") for page in reader.pages[:40]]
            return _collapse_ws("\n".join(chunks))[:MAX_TEXT_CHARS]
        except Exception:
            return ""


def _extract_html_text(raw: bytes, charset: str | None) -> tuple[str, str]:
    try:
        html = raw.decode(charset or "utf-8", errors="ignore")
    except LookupError:
        html = raw.decode("utf-8", errors="ignore")
    title = ""
    title_match = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
    if title_match:
        title = _collapse_ws(unescape(re.sub(r"<[^>]+>", " ", title_match.group(1))))[:180]
    meta = re.findall(
        r"<meta[^>]+(?:name|property)=[\"'](?:description|og:title|og:description|twitter:description)[\"'][^>]+content=[\"'](.*?)[\"'][^>]*>",
        html,
        re.I | re.S,
    )
    # Prefer main/article body text when present.
    body = html
    for pattern in (
        r"<article\b[^>]*>(.*?)</article>",
        r"<main\b[^>]*>(.*?)</main>",
        r"<body\b[^>]*>(.*?)</body>",
    ):
        match = re.search(pattern, html, re.I | re.S)
        if match and len(match.group(1)) > 400:
            body = match.group(1)
            break
    body = re.sub(r"<(script|style|noscript|svg|nav|footer|header)\b[^>]*>.*?</\1>", " ", body, flags=re.I | re.S)
    body = re.sub(r"<br\s*/?>", "\n", body, flags=re.I)
    body = re.sub(r"</p>", "\n\n", body, flags=re.I)
    body = re.sub(r"</(div|li|h[1-6]|tr)>", "\n", body, flags=re.I)
    body = re.sub(r"<[^>]+>", " ", body)
    body = _collapse_ws(unescape(body))
    chunks = [title] if title else []
    chunks.extend(_collapse_ws(unescape(m)) for m in meta[:6] if m)
    chunks.append(body)
    text = _collapse_ws("\n\n".join(c for c in chunks if c))[:MAX_TEXT_CHARS]
    if re.search(r"continue shopping|captcha|robot check|access denied", text, re.I):
        return text[:800], title
    return text, title


def _amazon_page_facts(html: str, url: str) -> tuple[str, str]:
    """Title + bullets for Amazon product pages (JS-heavy; title tag is reliable)."""
    asin = amazon_asin(url)
    title = ""
    title_span = re.search(r'<span[^>]+id=["\']productTitle["\'][^>]*>(.*?)</span>', html, re.I | re.S)
    if title_span:
        title = _collapse_ws(unescape(re.sub(r"<[^>]+>", " ", title_span.group(1))))[:240]
    if not title:
        og = re.search(
            r'<meta[^>]+(?:property|name)=["\']og:title["\'][^>]+content=["\'](.*?)["\']',
            html,
            re.I | re.S,
        )
        if og:
            title = _collapse_ws(unescape(og.group(1)))[:240]
    if not title:
        tm = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
        if tm:
            title = _collapse_ws(unescape(re.sub(r"<[^>]+>", " ", tm.group(1))))[:240]
    bullets: list[str] = []
    for raw in re.findall(
        r'id="feature-bullets".{0,12000}',
        html,
        re.I | re.S,
    )[:1]:
        for item in re.findall(r'class="a-list-item"[^>]*>(.*?)</(?:span|li)>', raw, re.I | re.S):
            line = _collapse_ws(unescape(re.sub(r"<[^>]+>", " ", item)))
            if line and len(line) > 8:
                bullets.append(line[:400])
            if len(bullets) >= 8:
                break
    lines = [
        f"Amazon product ASIN {asin}" if asin else "Amazon product page",
        f"URL: {url}",
    ]
    if title:
        lines.append(f"Title: {title}")
    if bullets:
        lines.append("Product details:")
        lines.extend(f"- {b}" for b in bullets)
    text = _collapse_ws("\n".join(lines))
    return text[:MAX_TEXT_CHARS], title


def extract_html_image(html: str, base_url: str) -> str:
    """Best-effort product photo URL from og:image / Amazon landing image."""
    text = html or ""
    for pattern in (
        r'<meta[^>]+(?:property|name)=["\'](?:og:image|og:image:url|twitter:image)["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\'](?:og:image|og:image:url|twitter:image)["\']',
        r'id=["\']landingImage["\'][^>]+data-old-hires=["\']([^"\']+)["\']',
        r'data-old-hires=["\']([^"\']+)["\'][^>]*id=["\']landingImage["\']',
        r'<link[^>]+rel=["\']image_src["\'][^>]+href=["\']([^"\']+)["\']',
    ):
        match = re.search(pattern, text, re.I | re.S)
        if match:
            resolved = _absolute_public_url(match.group(1), base_url)
            if resolved:
                return resolved
    dyn = re.search(r'data-a-dynamic-image=["\'](\{.*?\})["\']', text, re.I | re.S)
    if dyn:
        try:
            payload = json.loads(unescape(dyn.group(1)))
            if isinstance(payload, dict) and payload:
                best = max(
                    payload.items(),
                    key=lambda item: (
                        int(item[1][0]) * int(item[1][1])
                        if isinstance(item[1], (list, tuple)) and len(item[1]) >= 2
                        else 0
                    ),
                )
                resolved = _absolute_public_url(str(best[0]), base_url)
                if resolved:
                    return resolved
        except Exception:
            pass
    return ""


def _absolute_public_url(raw: str, base_url: str) -> str:
    url = unescape(str(raw or "")).strip()
    if not url or url.startswith("data:"):
        return ""
    try:
        joined = urllib.parse.urljoin(base_url or "", url)
        parsed = urllib.parse.urlparse(joined)
    except ValueError:
        return ""
    if parsed.scheme not in {"http", "https"} or _is_blocked_host(parsed.hostname):
        return ""
    return urllib.parse.urlunparse((parsed.scheme, parsed.netloc, parsed.path, "", parsed.query, ""))


def fetch_url_document(url: str) -> dict[str, Any]:
    clean = clean_url(url)
    if not clean:
        return {
            "url": (url or "").strip(),
            "ok": False,
            "error": "Blocked or invalid URL.",
            "title": "",
            "text": "",
            "kind": "unknown",
        }
    parsed = urllib.parse.urlparse(clean)
    path_lower = (parsed.path or "").lower()
    accept = "text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf,*/*;q=0.8"
    req = urllib.request.Request(
        clean,
        headers={
            "User-Agent": _BROWSER_UA,
            "Accept": accept,
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    try:
        from backend.services.link_preview import public_opener
        opener = public_opener()
        with opener.open(req, timeout=FETCH_TIMEOUT_SEC) as resp:
            ctype = (resp.headers.get("content-type") or "").lower()
            charset = resp.headers.get_content_charset()
            final_url = clean_url(str(resp.geturl() or clean)) or clean
            data = resp.read(MAX_DOWNLOAD_BYTES + 1)
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
        asin = amazon_asin(clean)
        if asin:
            title = f"Amazon ASIN {asin}"
            return {
                "url": clean,
                "ok": True,
                "error": str(exc)[:240],
                "title": title,
                "text": (
                    f"Amazon product ASIN {asin}\nURL: {clean}\n"
                    f"Could not download the product page ({str(exc)[:180]}). "
                    "Identify the part from the ASIN/title and ask the user for electrical specs if needed."
                ),
                "kind": "html",
            }
        return {
            "url": clean,
            "ok": False,
            "error": str(exc)[:240],
            "title": "",
            "text": "",
            "kind": "unknown",
        }

    truncated = len(data) > MAX_DOWNLOAD_BYTES
    if truncated:
        data = data[:MAX_DOWNLOAD_BYTES]

    is_pdf = (
        "application/pdf" in ctype
        or path_lower.endswith(".pdf")
        or data[:5] == b"%PDF-"
    )
    if is_pdf:
        text = _extract_pdf_text(data)
        title = stem_from_url(final_url) or "Datasheet PDF"
        if not text:
            return {
                "url": final_url,
                "ok": False,
                "error": "PDF downloaded but text could not be extracted.",
                "title": title,
                "text": "",
                "kind": "pdf",
            }
        return {
            "url": final_url,
            "ok": True,
            "error": "Downloaded PDF was truncated." if truncated else None,
            "title": title,
            "text": text,
            "kind": "pdf",
        }

    text, title = _extract_html_text(data, charset)
    html = ""
    try:
        html = data.decode(charset or "utf-8", errors="ignore")
    except LookupError:
        html = data.decode("utf-8", errors="ignore")
    image = extract_html_image(html, final_url)
    amazon = _is_amazon_host(urllib.parse.urlparse(final_url).hostname)
    if amazon:
        amazon_text, amazon_title = _amazon_page_facts(html, final_url)
        if amazon_title:
            title = amazon_title
        if amazon_text:
            text = amazon_text if len(amazon_text) >= 40 else f"{amazon_text}\n\n{text}".strip()
        if (not text or re.search(r"continue shopping|captcha|robot check|access denied", text, re.I)) and amazon_asin(final_url):
            asin = amazon_asin(final_url)
            title = title or f"Amazon ASIN {asin}"
            text = (
                f"Amazon product ASIN {asin}\n"
                f"URL: {final_url}\n"
                f"Title: {title}\n"
                "Amazon blocked a full product-page scrape. Use the ASIN/title for part identity "
                "and ask the user for electrical specs (voltage, current, pinout) if they are not in the title."
            )
        if not image:
            image = extract_html_image(html, final_url)
    if not text:
        return {
            "url": final_url,
            "ok": False,
            "error": "Page had no readable text.",
            "title": title,
            "text": "",
            "kind": "html",
            "image": image,
        }
    return {
        "url": final_url,
        "ok": True,
        "error": None,
        "title": title or stem_from_url(final_url) or "Product page",
        "text": text,
        "kind": "html",
        "image": image,
    }


def stem_from_url(url: str) -> str:
    try:
        name = urllib.parse.unquote(urllib.parse.urlparse(url).path.rsplit("/", 1)[-1])
        name = re.sub(r"\.(pdf|html?)$", "", name, flags=re.I)
        name = name.replace("-", " ").replace("_", " ").strip()
        return name[:120]
    except Exception:
        return ""


def fetch_documents_from_text(
    text: str,
    *,
    extra_urls: list[str] | None = None,
    limit: int = MAX_URLS,
) -> list[dict[str, Any]]:
    urls: list[str] = []
    for url in list(extra_urls or []) + urls_from_text(text, limit=limit):
        clean = clean_url(url)
        if clean and clean not in urls:
            urls.append(clean)
        if len(urls) >= limit:
            break
    docs: list[dict[str, Any]] = []
    for url in urls:
        docs.append(fetch_url_document(url))
    return docs


def documents_as_prompt_appendix(docs: list[dict[str, Any]], *, per_doc_chars: int = 12_000) -> str:
    usable = [d for d in docs if d.get("ok") and (d.get("text") or "").strip()]
    if not usable and not docs:
        return ""
    lines = ["\n\n--- Linked datasheet / product pages (fetched for this prompt) ---"]
    for idx, doc in enumerate(docs, 1):
        lines.append(f"\n{idx}. URL: {doc.get('url')}")
        if doc.get("title"):
            lines.append(f"   Title: {doc['title']}")
        if doc.get("kind"):
            lines.append(f"   Kind: {doc['kind']}")
        if doc.get("error"):
            lines.append(f"   Note: {doc['error']}")
        text = (doc.get("text") or "").strip()
        if text:
            excerpt = text[:per_doc_chars]
            lines.append("   Extracted content:")
            lines.append(excerpt)
            if len(text) > per_doc_chars:
                lines.append("   …(truncated)")
        elif not doc.get("ok"):
            lines.append("   (Could not retrieve page content — ask user for key pinout facts if needed.)")
    lines.append(
        "\nUse these linked documents for pinouts, voltages, connectors, and wiring guidance. "
        "Prefer explicit datasheet facts over guesses."
    )
    return "\n".join(lines)


def documents_as_reference_dicts(docs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    refs: list[dict[str, Any]] = []
    for doc in docs:
        if not doc.get("ok") or not (doc.get("text") or "").strip():
            continue
        url = str(doc.get("url") or "")
        digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:10]
        title = str(doc.get("title") or "Linked document").strip() or "Linked document"
        safe = re.sub(r"[^a-zA-Z0-9._-]+", "_", title)[:48] or "datasheet"
        refs.append(
            {
                "id": f"url-doc:{digest}",
                "type": "document",
                "label": title[:120],
                "filename": f"{safe}.txt",
                "url": url,
                "text_content": str(doc["text"])[:60_000],
                "text_truncated": len(str(doc["text"])) > 60_000,
            }
        )
    return refs
