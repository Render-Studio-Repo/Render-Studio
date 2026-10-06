"""Tiny one-page PDF writer. No extra dependencies."""
from __future__ import annotations


def pdf_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def pdf_bytes(title: str, body: str) -> bytes:
    return pdf_bytes_pages(title, body.splitlines())


def pdf_bytes_pages(title: str, lines: list[str], per_page: int = 48) -> bytes:
    safe_title = title.encode("latin-1", "replace").decode("latin-1")[:80]
    raw = [line.encode("latin-1", "replace").decode("latin-1")[:96] for line in lines] or [""]
    chunks = [raw[i : i + per_page] for i in range(0, len(raw), per_page)] or [[""]]
    page_streams: list[bytes] = []
    for idx, chunk in enumerate(chunks):
        content = ["BT", "/F1 12 Tf", "50 760 Td", f"({pdf_escape(safe_title)} p{idx + 1}) Tj", "/F1 9 Tf"]
        for line in chunk:
            content.append("0 -13 Td")
            content.append(f"({pdf_escape(line)}) Tj")
        content.append("ET")
        page_streams.append("\n".join(content).encode("latin-1"))
    objects: list[bytes] = []
    # catalog + pages tree built after we know page object numbers
    n_pages = len(page_streams)
    # objects: 1 catalog, 2 pages, 3..n+2 pages, then contents, then font
    page_ids = list(range(3, 3 + n_pages))
    content_ids = list(range(3 + n_pages, 3 + 2 * n_pages))
    font_id = 3 + 2 * n_pages
    kids = " ".join(f"{i} 0 R" for i in page_ids)
    objects.append(b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n")
    objects.append(f"2 0 obj << /Type /Pages /Kids [{kids}] /Count {n_pages} >> endobj\n".encode())
    for pid, cid in zip(page_ids, content_ids):
        objects.append(
            f"{pid} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {cid} 0 R /Resources << /Font << /F1 {font_id} 0 R >> >> >> endobj\n".encode()
        )
    for cid, stream in zip(content_ids, page_streams):
        objects.append(
            f"{cid} 0 obj << /Length {len(stream)} >> stream\n".encode()
            + stream
            + b"\nendstream endobj\n"
        )
    objects.append(f"{font_id} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n".encode())
    out = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for obj in objects:
        offsets.append(len(out))
        out.extend(obj)
    xref = len(out)
    out.extend(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        out.extend(f"{offset:010d} 00000 n \n".encode())
    out.extend(f"trailer << /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return bytes(out)
