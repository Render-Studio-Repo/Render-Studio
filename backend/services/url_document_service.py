"""Fetch public product pages / datasheet PDFs and extract text for AI prompts."""

from __future__ import annotations

import hashlib
import io
import ipaddress
import re
import socket
import urllib.error
import urllib.parse
import urllib.request
from html import unescape
from typing import Any

URL_RE = re.compile(r"https?://[^\s<>\]\)\"']+", re.I)
MAX_URLS = 3
MAX_DOWNLOAD_BYTES = 2_500_000
MAX_TEXT_CHARS = 24_000
FETCH_TIMEOUT_SEC = 12


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


def clean_url(url: str | None) -> str | None:
    raw = (url or "").strip().rstrip(".,;:!?)\"]'")
    if not raw:
        return None
    try:
        parsed = urllib.parse.urlparse(raw)
    except ValueError:
        return None
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    if _is_blocked_host(parsed.hostname):
        return None
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
    accept = "application/pdf,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    req = urllib.request.Request(
        clean,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (compatible; RenderStudioBot/1.0; +https://render3d.app) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
            ),
            "Accept": accept,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT_SEC) as resp:
            ctype = (resp.headers.get("content-type") or "").lower()
            charset = resp.headers.get_content_charset()
            final_url = clean_url(str(resp.geturl() or clean)) or clean
            data = resp.read(MAX_DOWNLOAD_BYTES + 1)
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
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
    if not text:
        return {
            "url": final_url,
            "ok": False,
            "error": "Page had no readable text.",
            "title": title,
            "text": "",
            "kind": "html",
        }
    return {
        "url": final_url,
        "ok": True,
        "error": None,
        "title": title or stem_from_url(final_url) or "Product page",
        "text": text,
        "kind": "html",
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
