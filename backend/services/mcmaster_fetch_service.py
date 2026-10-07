"""Download McMaster-Carr STEP files onto the studio server with a headless crawler.

Harnesses look up those files in the project / mcmaster_library/ instead of asking
the user to save CAD into Chrome Downloads. Purchase URLs stay on the parts list.
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import threading
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Callable, Optional

from backend.services import cad_service

logger = logging.getLogger("render3d.mcmaster_fetch")

ProgressCb = Optional[Callable[[dict[str, Any]], None]]
CancelCb = Optional[Callable[[], bool]]
RetryCb = Optional[Callable[[int, int, BaseException], None]]

_PN_RE = re.compile(r"^[0-9]{3,6}[A-Za-z][0-9A-Za-z]{1,8}$")
_STEP_HREF_RE = re.compile(r"\.(?:step|stp)(?:$|[/?#])", re.I)
_CAD_SUFFIXES = {".step", ".stp", ".sat", ".x_t", ".x_b", ".iges", ".igs", ".sldprt", ".sldasm"}
_STEP_SUFFIXES = {".step", ".stp"}
_CONVERTIBLE_CAD_SUFFIXES = {".step", ".stp", ".sat", ".x_t", ".x_b", ".iges", ".igs"}
_SOLIDWORKS_SUFFIXES = {".sldprt", ".sldasm"}
_COMPLETE_CAD_SUFFIXES = {".step", ".stp", ".glb", ".stl"}
_DONE_PART_STATUSES = {"on_server", "used", "downloaded", "substituted"}
_NO_RESULTS_RE = re.compile(
    r"no results|0 results|couldn['’]t find|could not find|did not match|"
    r"no products|we didn['’]t find|try a different search|0 products",
    re.I,
)
_HREF_PN_RE = re.compile(
    r"(?:https?://(?:www\.)?mcmaster\.com/|/)?([0-9]{3,6}[A-Za-z][0-9A-Za-z]{1,8})(?:/|$|\?|#)",
    re.I,
)
_STEP_PREVIEW_GUARD = threading.Lock()
_STEP_PREVIEW_THREADS: dict[str, threading.Thread] = {}
_STEP_PREVIEW_FAILED_AT: dict[str, float] = {}
_STEP_PREVIEW_FAIL_COOLDOWN_SEC = 10 * 60
_MAX_PARTS_PER_JOB = 48
# Two Chromium processes max — each is reused across many PNs. Three parallel
# launches were gassing RAM/CPU without finishing faster.
_MAX_CONCURRENT_FETCHES = 2
# One crawl per PN. Similar-part search happens inside that crawl, then we move on.
_FETCH_ATTEMPTS = 1
_NAV_TIMEOUT_MS = 12_000
_DOWNLOAD_TIMEOUT_MS = 4_000
_NAV_SETTLE_MS = 150
_PRODUCT_HYDRATE_MS = 3_500
_CAD_SECTION_TIMEOUT_MS = 2_500
_SUBSTITUTE_HYDRATE_MS = 2_500
_MAX_SUBSTITUTE_CANDIDATES = 4
_FETCH_GATE = threading.Semaphore(_MAX_CONCURRENT_FETCHES)

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


class McMasterCatalogMiss(RuntimeError):
    """McMaster never hydrated a product page (bad PN or empty search)."""


def _short_fetch_error(exc: BaseException) -> str:
    text = str(exc or "").replace("\n", " ").strip()
    low = text.lower()
    if "executable doesn't exist" in low or "playwright was just installed" in low:
        return "Chromium missing (Playwright). Retry after install."
    if "timed out" in low:
        return "Timed out opening McMaster page."
    if "no 3-d step" in low or "no 3-d" in low:
        return "Page loaded; STEP download did not start."
    if "no product page" in low or "not in catalog" in low or "catalog miss" in low:
        return "McMaster has no product page for this PN."
    if "solidworks" in low or ".sldprt" in low:
        return "McMaster saved SolidWorks instead of STEP."
    return text[:80]


def _is_step_miss_error(exc: BaseException | str) -> bool:
    text = str(exc or "").lower()
    return "no 3-d step" in text or "did not start" in text


def _is_terminal_fetch_note(used_in: str) -> bool:
    """True when a later generate should not recrawl this PN."""
    used = str(used_in or "").lower()
    return (
        "no substitute" in used
        or "no product page" in used
        or "not in catalog" in used
        or "did not start" in used
        or "no 3-d step" in used
        or "no step" in used
    )


def _is_retryable_fetch_error(exc: BaseException) -> bool:
    """True for flaky McMaster UI/network misses — not missing Chromium or bad PNs."""
    text = str(exc or "").lower()
    if "not a mcmaster-carr part number" in text:
        return False
    if "no product page" in text or "not in catalog" in text or "catalog miss" in text:
        return False
    if _is_step_miss_error(text):
        return False
    if "playwright" in text and ("install" in text or "doesn't exist" in text or "executable" in text):
        return False
    return True


def normalize_part_number(value: str) -> str:
    return re.sub(r"[^0-9A-Za-z]", "", str(value or "")).upper()


def looks_like_part_number(value: str) -> bool:
    return bool(_PN_RE.fullmatch(normalize_part_number(value)))


def product_url(part_number: str) -> str:
    pn = normalize_part_number(part_number)
    return f"https://www.mcmaster.com/{pn}/" if pn else "https://www.mcmaster.com/"


def page_has_no_results(text: str) -> bool:
    return bool(_NO_RESULTS_RE.search(str(text or "")))


def extract_product_pns(html: str, *, exclude: str = "") -> list[str]:
    """Pull McMaster PNs from product/search HTML (hrefs, not the missing query)."""
    skip = normalize_part_number(exclude)
    seen: set[str] = set()
    out: list[str] = []
    for match in _HREF_PN_RE.finditer(str(html or "")):
        pn = normalize_part_number(match.group(1))
        if not looks_like_part_number(pn) or pn == skip or pn in seen:
            continue
        seen.add(pn)
        out.append(pn)
        if len(out) >= 24:
            break
    return out


def family_prefix(part_number: str) -> str:
    """Series code McMaster uses for a family page, e.g. 91290A440 → 91290A."""
    pn = normalize_part_number(part_number)
    match = re.match(r"^([0-9]{3,6}[A-Za-z]+)", pn)
    return match.group(1) if match else ""


def simplify_search_query(text: str, *, original_pn: str = "") -> str:
    raw = str(text or "")
    if original_pn:
        raw = re.sub(re.escape(original_pn), " ", raw, flags=re.I)
    raw = re.sub(r"https?://\S+", " ", raw)
    raw = re.sub(r"[^A-Za-z0-9.\-×x/ ]+", " ", raw)
    stop = {
        "mcmaster", "carr", "catalog", "hardware", "pack", "each", "the", "and",
        "for", "with", "from", "part", "number", "buy", "qty",
    }
    tokens = [tok for tok in raw.split() if tok and tok.lower() not in stop]
    return " ".join(tokens[:8]).strip()


def substitute_search_queries(search_query: str, original_pn: str) -> list[str]:
    """Queries to try after a catalog miss — never search the dead PN alone."""
    pn = normalize_part_number(original_pn)
    fam = family_prefix(pn)
    out: list[str] = []
    seen: set[str] = set()

    def add(raw: str) -> None:
        cleaned = simplify_search_query(raw, original_pn=pn)
        if not cleaned:
            return
        key = cleaned.lower()
        if key in seen:
            return
        seen.add(key)
        out.append(cleaned)

    add(search_query)
    for extra in fastener_search_queries(search_query, pn):
        add(extra)
    if fam:
        add(fam)
    if fam.upper().startswith("5537"):
        add("drop-in T-nut")
        add("T-slot nut")
    return out


def fastener_search_queries(search_query: str, original_pn: str) -> list[str]:
    """Similar-part searches: M4 socket head, 4 mm screw, hook-and-loop, etc."""
    blob = f"{search_query or ''} {original_pn or ''}"
    low = blob.lower()
    out: list[str] = []
    seen: set[str] = set()

    def add(raw: str) -> None:
        cleaned = simplify_search_query(raw, original_pn=original_pn)
        if not cleaned:
            return
        key = cleaned.lower()
        if key in seen:
            return
        seen.add(key)
        out.append(cleaned)

    thread = re.search(r"\bM\s*([1-9]\d*(?:\.\d+)?)\b", blob, re.I)
    size = f"M{thread.group(1)}" if thread else ""
    if not size:
        mm = re.search(r"\b([1-9]\d*)\s*mm\b", low)
        if mm and re.search(r"\b(screw|bolt|shcs|insert|nut|washer)\b", low):
            size = f"M{mm.group(1)}"

    kind = ""
    if re.search(r"socket head|shcs", low):
        kind = "socket head cap screw"
    elif re.search(r"button head", low):
        kind = "button head screw"
    elif re.search(r"heat-?set|threaded insert", low):
        kind = "heat-set insert"
    elif re.search(r"\bwasher\b", low):
        kind = "washer"
    elif re.search(r"hook.?and.?loop|velcro|\bstrap\b", low):
        kind = "hook and loop strap"
    elif re.search(r"rubber (foot|bumper)|unthreaded-hole bumper|\bbumper\b", low):
        kind = "rubber bumper"
    elif re.search(r"locknut|nyloc", low):
        kind = "nylon insert locknut"
    elif re.search(r"\bscrew\b", low):
        kind = "socket head cap screw"

    if size and kind:
        add(f"{size} {kind}")
    elif kind:
        add(kind)
    if size and "screw" in kind:
        add(f"{size} screw")
    return out


def _same_family_pns(candidates: list[str], original_pn: str) -> list[str]:
    pn = normalize_part_number(original_pn)
    fam = family_prefix(pn)
    if not fam:
        return [item for item in candidates if item != pn]
    return [item for item in candidates if item.startswith(fam) and item != pn]


def search_url(query: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", str(query or "").lower()).strip("-")
    return f"https://www.mcmaster.com/{slug}/" if slug else "https://www.mcmaster.com/"


def fetch_worker_count(n_parts: int) -> int:
    n = max(0, int(n_parts))
    if n <= 1:
        return 1
    cap = _MAX_CONCURRENT_FETCHES
    raw = str(os.environ.get("MCMASTER_FETCH_WORKERS") or "").strip()
    if raw.isdigit():
        cap = max(1, min(_MAX_CONCURRENT_FETCHES, int(raw)))
    return min(cap, n)


def _split_chunks(items: list[str], n_chunks: int) -> list[list[str]]:
    if not items:
        return []
    workers = max(1, min(int(n_chunks), len(items)))
    if workers == 1:
        return [items]
    mid = (len(items) + 1) // 2
    return [chunk for chunk in (items[:mid], items[mid:]) if chunk]


def _href_looks_like_step(href: str) -> bool:
    return bool(_STEP_HREF_RE.search(str(href or "")))


def _href_looks_like_solidworks(href: str) -> bool:
    low = str(href or "").lower()
    return ".sldprt" in low or ".sldasm" in low or "solidworks" in low


def _preview_fetch_key(project_path: Path, stem: str) -> str:
    pn = normalize_part_number(stem) or str(stem or "").strip().upper()
    try:
        root = str(Path(project_path).resolve())
    except OSError:
        root = str(project_path)
    return f"{root}::{pn}"


def _viewport_ready_cad(project_path: Path, stem: str) -> Path | None:
    """GLB/STEP/STL the viewer can load — not a SolidWorks native.

    Prefer an existing GLB so the site never crawls McMaster or tessellates STEP
    just to open a catalog part that is already meshed.
    """
    root = Path(project_path)
    clean = Path(stem).stem if Path(stem).suffix else str(stem)
    glb = cad_service.find_cad_file_for_stem(root, clean, {".glb", ".gltf"})
    if glb is not None:
        return glb
    step = cad_service.find_step_source(root, clean)
    if step is not None:
        return step
    stl = cad_service.find_cad_file_for_stem(root, clean, {".stl"})
    if stl is not None:
        return stl
    return None


def _part_step_and_glb(project_path: Path, part_number: str) -> tuple[Path | None, Path | None]:
    pn = normalize_part_number(part_number)
    if not pn:
        return None, None
    root = Path(project_path)
    return (
        cad_service.find_step_source(root, pn),
        cad_service.find_cad_file_for_stem(root, pn, {".glb", ".gltf"}),
    )


def library_has_part(project_path: Path, part_number: str) -> dict[str, Any] | None:
    pn = normalize_part_number(part_number)
    if not pn:
        return None
    root = Path(project_path)
    for entry in cad_service.list_mcmaster_library(root) or []:
        if normalize_part_number(str(entry.get("part_number") or "")) != pn:
            continue
        name = str(entry.get("project_filename") or entry.get("filename") or "")
        ready = _viewport_ready_cad(root, name or pn)
        if ready is not None:
            return {**entry, "filename": ready.name, "path": str(ready)}
    for folder in (root, root / cad_service.MCMASTER_LIBRARY_DIRNAME):
        if not folder.is_dir():
            continue
        for path in folder.iterdir():
            if not path.is_file():
                continue
            stem = path.stem.upper().replace("-", "")
            if not stem.startswith(pn):
                continue
            ready = _viewport_ready_cad(root, path.stem)
            if ready is not None:
                return {"filename": ready.name, "part_number": pn, "path": str(ready)}
            if path.suffix.lower() in {".glb", ".stl"}:
                return {"filename": path.name, "part_number": pn, "path": str(path)}
            if path.suffix.lower() in _STEP_SUFFIXES and cad_service.looks_like_step_file(path):
                return {"filename": path.name, "part_number": pn, "path": str(path)}
    return None


def _can_family_fallback(exc: BaseException) -> bool:
    text = str(exc or "").lower()
    if "not a mcmaster-carr part number" in text:
        return False
    if "playwright" in text and ("install" in text or "doesn't exist" in text or "executable" in text):
        return False
    return True


def _result_from_library_family(
    project_path: Path,
    part_number: str,
    *,
    title: str = "",
    cause: BaseException | None = None,
) -> dict[str, Any] | None:
    """When the requested PN has no STEP, seed from a same-family file already on disk."""
    if cause is not None and not _can_family_fallback(cause):
        return None
    hit = library_family_part(project_path, part_number)
    if not hit:
        return None
    used = normalize_part_number(str(hit.get("part_number") or Path(str(hit.get("filename") or "")).stem))
    cad_name = str(hit.get("filename") or "")
    if not used or not cad_name:
        return None
    logger.info(
        "McMaster %s has no STEP — using on-disk family part %s",
        part_number,
        used,
    )
    cad_service.upsert_mcmaster_part(
        project_path,
        part_number,
        status="substituted",
        buy_url=product_url(part_number),
        used_in=f"using {used} instead",
    )
    cad_service.upsert_mcmaster_part(
        project_path,
        used,
        status="on_server",
        buy_url=product_url(used),
        description=title or str(hit.get("title") or ""),
        used_in=cad_name,
    )
    viewer = Path(cad_name).with_suffix(".glb").name if cad_name else cad_name
    return {
        "ok": True,
        "cached": True,
        "part_number": used,
        "substituted_from": part_number,
        "page_url": product_url(used),
        "filename": cad_name,
        "viewer_filename": viewer,
        "title": title or str(hit.get("title") or ""),
    }


def library_family_part(project_path: Path, part_number: str) -> dict[str, Any] | None:
    """A same-series catalog STEP already on disk (91290A324 → 91290A252)."""
    pn = normalize_part_number(part_number)
    fam = family_prefix(pn)
    if not pn or not fam:
        return None
    seen: set[str] = set()
    root = Path(project_path)

    def _accept(other: str) -> dict[str, Any] | None:
        other = normalize_part_number(other)
        if not other or other == pn or other in seen or not other.startswith(fam):
            return None
        if not looks_like_part_number(other):
            return None
        seen.add(other)
        found = library_has_part(root, other)
        return {**found, "part_number": other} if found else None

    for entry in cad_service.list_mcmaster_library(root) or []:
        hit = _accept(str(entry.get("part_number") or Path(str(entry.get("filename") or "")).stem))
        if hit:
            return hit
    for folder in (root, root / cad_service.MCMASTER_LIBRARY_DIRNAME):
        if not folder.is_dir():
            continue
        for path in folder.iterdir():
            if not path.is_file():
                continue
            hit = _accept(path.stem)
            if hit:
                return hit
    return None


def _has_solidworks_native(project_path: Path, stem: str) -> bool:
    prop = cad_service.find_proprietary_cad_source(project_path, stem)
    if prop is not None and prop.suffix.lower() in _SOLIDWORKS_SUFFIXES:
        return True
    pn = normalize_part_number(stem)
    if not pn:
        return False
    root = Path(project_path)
    for folder in (root, root / cad_service.MCMASTER_LIBRARY_DIRNAME):
        if not folder.is_dir():
            continue
        for suffix in _SOLIDWORKS_SUFFIXES:
            candidate = folder / f"{pn}{suffix}"
            if candidate.is_file():
                return True
    return False


def can_fetch_mcmaster_step_for_preview(project_path: Path, stem: str) -> bool:
    """True when a missing GLB is a McMaster SolidWorks native we can replace with STEP."""
    pn = normalize_part_number(stem)
    if not looks_like_part_number(pn):
        return False
    if _viewport_ready_cad(project_path, pn) is not None:
        return False
    if not _has_solidworks_native(project_path, pn):
        return False
    key = _preview_fetch_key(project_path, pn)
    failed_at = _STEP_PREVIEW_FAILED_AT.get(key) or 0.0
    if failed_at and (time.time() - failed_at) < _STEP_PREVIEW_FAIL_COOLDOWN_SEC:
        return False
    return True


def is_mcmaster_step_fetch_pending(project_path: Path, stem: str, glb_path: Path | None = None) -> bool:
    pn = normalize_part_number(stem) or str(stem or "").strip()
    key = _preview_fetch_key(project_path, pn)
    with _STEP_PREVIEW_GUARD:
        existing = _STEP_PREVIEW_THREADS.get(key)
        if existing is not None and existing.is_alive():
            return True
    dest = Path(glb_path) if glb_path is not None else Path(project_path) / f"{pn}.glb"
    return cad_service.is_preview_glb_building(dest)


def schedule_mcmaster_step_preview(
    project_path: Path,
    stem: str,
    *,
    glb_path: Path | None = None,
    on_done: Optional[Callable[[Path | None, BaseException | None], None]] = None,
) -> bool:
    """Fetch McMaster STEP in a daemon thread so GET /files/*.glb can 503-poll.

    Returns True if a fetch is already in flight or was started.
    """
    project_path = Path(project_path)
    pn = normalize_part_number(stem)
    dest = Path(glb_path) if glb_path is not None else project_path / f"{pn}.glb"
    key = _preview_fetch_key(project_path, pn)
    lock = cad_service.preview_glb_build_lock_path(dest)

    with _STEP_PREVIEW_GUARD:
        existing = _STEP_PREVIEW_THREADS.get(key)
        if existing is not None and existing.is_alive():
            return True
        if cad_service.is_preview_glb_building(dest):
            return True
        if dest.is_file() and dest.stat().st_size > 0:
            return False
        if not can_fetch_mcmaster_step_for_preview(project_path, pn):
            return False
        try:
            fd = os.open(str(lock), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(f"{os.getpid()}\n{time.time()}\n{pn}\n")
        except FileExistsError:
            if cad_service.is_preview_glb_building(dest):
                return True
            try:
                lock.unlink(missing_ok=True)
                fd = os.open(str(lock), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                with os.fdopen(fd, "w", encoding="utf-8") as fh:
                    fh.write(f"{os.getpid()}\n{time.time()}\n{pn}\n")
            except FileExistsError:
                return True
        except OSError:
            return False

        def _run() -> None:
            err: BaseException | None = None
            out: Path | None = None
            try:
                result = fetch_part_for_project(project_path, pn)
                viewer = str(result.get("viewer_filename") or "")
                candidate = project_path / Path(viewer).name if viewer else dest
                out = cad_service.wait_for_preview_glb(candidate) or cad_service.wait_for_preview_glb(dest)
                if out is None:
                    step = cad_service.find_step_source(project_path, pn)
                    if step is not None:
                        out = cad_service.tessellate_step_to_glb(step, dest)
                if out is None or not Path(out).is_file():
                    raise RuntimeError(f"McMaster STEP fetch for {pn} did not produce a GLB preview")
                _STEP_PREVIEW_FAILED_AT.pop(key, None)
            except BaseException as exc:  # noqa: BLE001 — surface to callback, then clear lock
                err = exc
                _STEP_PREVIEW_FAILED_AT[key] = time.time()
                logger.warning("Background McMaster STEP preview failed for %s: %s", pn, exc)
            finally:
                try:
                    lock.unlink(missing_ok=True)
                except OSError:
                    pass
                with _STEP_PREVIEW_GUARD:
                    _STEP_PREVIEW_THREADS.pop(key, None)
                if on_done is not None:
                    try:
                        on_done(out, err)
                    except Exception as cb_exc:  # pragma: no cover
                        logger.debug("McMaster STEP preview on_done failed: %s", cb_exc)

        thread = threading.Thread(
            target=_run,
            name=f"mcmaster-step-preview:{pn[:24]}",
            daemon=True,
        )
        _STEP_PREVIEW_THREADS[key] = thread
        thread.start()
        return True


def listed_catalog_part_numbers(
    project_path: Path,
    *,
    rows: list[dict[str, Any]] | None = None,
) -> list[str]:
    """McMaster PNs from the parts list that are still in play (not removed)."""
    parsed = rows or cad_service.parse_mcmaster_parts_rows(
        cad_service.read_mcmaster_parts_list(project_path)
    )
    wanted: list[str] = []
    for row in parsed:
        status = str(row.get("status") or "").lower()
        if status in {"removed", "substituted"}:
            continue
        pn = normalize_part_number(row.get("part_number") or "")
        if not looks_like_part_number(pn) or pn in wanted:
            continue
        if status == "fetch_failed":
            if _is_terminal_fetch_note(str(row.get("used_in") or "")):
                continue
        wanted.append(pn)
    return wanted


def missing_listed_catalog_pns(
    project_path: Path,
    *,
    rows: list[dict[str, Any]] | None = None,
) -> list[str]:
    """PNs that still need a Playwright crawl — GLB or STEP on disk is enough."""
    return [
        pn
        for pn in listed_catalog_part_numbers(project_path, rows=rows)
        if not library_has_part(project_path, pn)
    ]


def reconcile_mcmaster_on_disk(project_path: Path) -> int:
    """Mark listed PNs ``on_server`` when STEP/GLB already exists. Returns rows updated."""
    project_path = Path(project_path)
    rows = cad_service.parse_mcmaster_parts_rows(
        cad_service.read_mcmaster_parts_list(project_path)
    )
    updated = 0
    for row in rows:
        status = str(row.get("status") or "").lower()
        if status in {"removed", "substituted", "used", "on_server"}:
            continue
        pn = normalize_part_number(row.get("part_number") or "")
        if not looks_like_part_number(pn):
            continue
        hit = library_has_part(project_path, pn)
        if not hit:
            continue
        fields: dict[str, str] = {"status": "on_server"}
        if not str(row.get("used_in") or "").strip():
            name = str(hit.get("filename") or "").strip()
            if name:
                fields["used_in"] = name
        cad_service.upsert_mcmaster_part(project_path, pn, **fields)
        updated += 1
    return updated


def fetch_listed_parts_for_project(
    project_path: Path,
    *,
    rows: list[dict[str, Any]] | None = None,
    progress_callback: ProgressCb = None,
    cancel_check: CancelCb = None,
    max_parts: int = _MAX_PARTS_PER_JOB,
    fetch_attempts: int | None = None,
) -> dict[str, Any]:
    """Download STEP for planned parts-list PNs that are not already on the server."""
    project_path = Path(project_path)
    reconcile_mcmaster_on_disk(project_path)
    parsed = rows or cad_service.parse_mcmaster_parts_rows(
        cad_service.read_mcmaster_parts_list(project_path)
    )
    desc_by_pn: dict[str, str] = {}
    for row in parsed:
        pn = normalize_part_number(row.get("part_number") or "")
        if looks_like_part_number(pn):
            desc_by_pn[pn] = str(row.get("description") or "").strip()
    wanted = missing_listed_catalog_pns(project_path, rows=parsed)[: max(1, int(max_parts))]

    progress_lock = threading.Lock()
    completed = {"n": 0}

    def _push(extra: str = "", *, pct: int = 12) -> None:
        with progress_lock:
            progress = cad_service.mcmaster_parts_progress(project_path)
            done = int(progress.get("mcmaster_done") or 0)
            total = int(progress.get("mcmaster_total") or 0)
            label = f"McMaster · {done}/{total} parts complete" if total else "McMaster · fetching catalog STEPs…"
            if extra:
                label = f"{label} · {extra}"
            push_mcmaster_progress(
                progress_callback,
                project_path,
                stage="hardware",
                pct=pct,
                label=label,
            )

    _push("download STEPs before drawing")
    if not wanted:
        _push("already on server · ready to draw", pct=14)
        return {
            "requested": [],
            "fetched": [],
            "errors": [],
            "count": 0,
            **cad_service.mcmaster_parts_progress(project_path),
        }

    fetched: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []

    def _fetch_one(session: Any, pn: str) -> tuple[str, dict[str, Any] | None, str | None]:
        if cancel_check and cancel_check():
            return pn, None, "canceled"
        query = desc_by_pn.get(pn) or pn
        cad_service.upsert_mcmaster_part(project_path, pn, status="fetching", buy_url=product_url(pn))
        _push(f"fetching {pn}")

        def _on_retry(attempt: int, total: int, exc: BaseException) -> None:
            cad_service.upsert_mcmaster_part(
                project_path,
                pn,
                status="retrying",
                buy_url=product_url(pn),
                used_in=f"retry {attempt}/{total} · {_short_fetch_error(exc)}",
            )
            _push(f"retrying {pn} ({attempt}/{total})")

        try:
            result = fetch_part_for_project(
                project_path,
                pn,
                title=desc_by_pn.get(pn) or "",
                on_retry=_on_retry,
                session=session,
                search_query=query,
                max_attempts=fetch_attempts,
            )
            completed["n"] += 1
            _push(result.get("part_number") or pn, pct=14)
            return pn, result, None
        except Exception as exc:
            logger.warning("McMaster fetch failed for %s: %s", pn, exc)
            try:
                cad_service.upsert_mcmaster_part(
                    project_path,
                    pn,
                    status="fetch_failed",
                    buy_url=product_url(pn),
                    used_in=_short_fetch_error(exc),
                )
            except Exception:
                pass
            completed["n"] += 1
            _push(f"{pn} failed")
            return pn, None, str(exc)[:400]

    def _run_chunk(chunk: list[str]) -> list[tuple[str, dict[str, Any] | None, str | None]]:
        ordered: list[tuple[str, dict[str, Any] | None, str | None]] = []
        with _McMasterSession() as session:
            for pn in chunk:
                ordered.append(_fetch_one(session, pn))
        return ordered

    workers = fetch_worker_count(len(wanted))
    chunks = _split_chunks(wanted, workers)
    ordered: list[tuple[str, dict[str, Any] | None, str | None]] = []
    if len(chunks) <= 1:
        ordered = _run_chunk(chunks[0] if chunks else [])
    else:
        with ThreadPoolExecutor(max_workers=len(chunks), thread_name_prefix="mcmaster-fetch") as pool:
            futs = [pool.submit(_run_chunk, chunk) for chunk in chunks]
            for fut in as_completed(futs):
                ordered.extend(fut.result())

    for pn, result, err in ordered:
        if result:
            fetched.append(result)
        elif err and err != "canceled":
            errors.append({"part_number": pn, "error": err})
    _push("catalog STEPs ready · drawing next", pct=16)
    return {
        "requested": wanted,
        "fetched": fetched,
        "errors": errors,
        "count": len(fetched),
        **cad_service.mcmaster_parts_progress(project_path),
    }


def push_mcmaster_progress(
    progress_callback: ProgressCb,
    project_path: Path,
    **kwargs: Any,
) -> None:
    if not progress_callback:
        return
    payload = cad_service.mcmaster_parts_progress(project_path)
    payload.update({key: value for key, value in kwargs.items() if value is not None})
    progress_callback(payload)


def _emit_fetched_glb(
    progress_callback: ProgressCb,
    project_path: Path,
    result: dict[str, Any],
    *,
    append: bool,
) -> None:
    """No-op: catalog GLBs are worker inputs, not live viewport meshes.

    VibeCAD imports STEPs in the isolated worker and publishes one assembly GLB.
    Dumping each McMaster PN into Three.js stacked fasteners at the origin.
    """
    return


def fetch_part_for_project(
    project_path: Path,
    part_number: str,
    *,
    title: str = "",
    on_retry: RetryCb = None,
    session: Any | None = None,
    search_query: str = "",
    max_attempts: int | None = None,
) -> dict[str, Any]:
    """Download one McMaster STEP onto the server and record it for harness lookup."""
    pn = normalize_part_number(part_number)
    if not looks_like_part_number(pn):
        raise ValueError(f"Not a McMaster-Carr part number: {part_number!r}")
    project_path = Path(project_path)
    existing = library_has_part(project_path, pn)
    if existing:
        step, glb = _part_step_and_glb(project_path, pn)
        cad_name = (step.name if step is not None else None) or str(
            existing.get("project_filename") or existing.get("filename") or ""
        )
        cad_service.upsert_mcmaster_part(
            project_path,
            pn,
            status="on_server",
            buy_url=product_url(pn),
            description=title or existing.get("title") or "",
            used_in=cad_name,
        )
        viewer = glb.name if glb is not None else (
            str(Path(cad_name).with_suffix(".glb").name) if cad_name else ""
        )
        return {
            "ok": True,
            "cached": True,
            "part_number": pn,
            "page_url": product_url(pn),
            "filename": cad_name,
            "viewer_filename": viewer,
            "title": title or existing.get("title") or "",
        }

    tmp_dir = project_path / ".mcmaster_fetch" / pn
    tmp_dir.mkdir(parents=True, exist_ok=True)
    try:
        try:
            downloaded = _crawl_download_cad(
                pn,
                tmp_dir,
                on_retry=on_retry,
                session=session,
                search_query=search_query or title,
                max_attempts=max_attempts,
            )
        except Exception as exc:
            fallback = _result_from_library_family(project_path, pn, title=title, cause=exc)
            if fallback:
                return fallback
            raise
        used_pn = normalize_part_number(str(downloaded.get("part_number") or pn)) or pn
        substituted_from = normalize_part_number(str(downloaded.get("substituted_from") or ""))
        src = Path(downloaded["path"])
        cad_name = f"{used_pn}{src.suffix.lower() if src.suffix.lower() in _CAD_SUFFIXES else '.step'}"
        dest = project_path / cad_name
        if dest.exists() and dest.resolve() != src.resolve():
            dest = project_path / f"{used_pn}_{src.stem}{src.suffix.lower() or '.step'}"
        shutil.copy2(src, dest)
        dest = _promote_to_step(dest, project_path)
        if dest.suffix.lower() in _SOLIDWORKS_SUFFIXES:
            raise RuntimeError(
                f"McMaster saved SolidWorks {dest.name} instead of 3-D STEP. "
                f"The viewport needs STEP — retry or download STEP from {product_url(used_pn)}"
            )

        glb_name = ""
        if dest.suffix.lower() in _STEP_SUFFIXES:
            glb_dest = dest.with_suffix(".glb")
            glb_name = glb_dest.name
            try:
                if glb_dest.is_file() and glb_dest.stat().st_size > 64:
                    pass
                else:
                    # Off-thread: blocking XCAF here froze the API while Generate ran.
                    cad_service.schedule_tessellate_step_to_glb(dest, glb_dest)
            except Exception as exc:
                logger.warning("Could not schedule McMaster STEP preview %s: %s", dest.name, exc)
        elif dest.suffix.lower() in {".iges", ".igs"}:
            try:
                mesh = cad_service.load_mesh(dest)
                glb_path = cad_service.export_mesh(mesh, dest.with_suffix(".glb"))
                glb_name = glb_path.name if glb_path.is_file() else ""
            except Exception as exc:
                logger.warning("Could not tessellate McMaster IGES %s: %s", dest.name, exc)

        page = str(downloaded.get("page_url") or product_url(used_pn))
        found_title = str(downloaded.get("title") or title or "").strip()
        cad_service.record_mcmaster_library_entries(
            project_path,
            [dest.name],
            source="mcmaster-crawler",
            page_urls={dest.name: page},
            part_numbers={dest.name: used_pn},
            titles={dest.name: found_title},
        )
        if substituted_from and substituted_from != used_pn:
            cad_service.upsert_mcmaster_part(
                project_path,
                substituted_from,
                status="substituted",
                buy_url=product_url(substituted_from),
                used_in=f"using {used_pn} instead",
            )
        cad_service.upsert_mcmaster_part(
            project_path,
            used_pn,
            status="on_server",
            buy_url=page,
            description=found_title or title,
            used_in=dest.name,
        )
        return {
            "ok": True,
            "cached": False,
            "part_number": used_pn,
            "substituted_from": substituted_from,
            "page_url": page,
            "filename": dest.name,
            "viewer_filename": glb_name or dest.name,
            "title": found_title,
            "bytes": dest.stat().st_size if dest.is_file() else 0,
        }
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def fetch_part_for_agent(
    project_path: Path,
    part_number: str,
    *,
    progress_callback: ProgressCb = None,
    emit_preview: bool = True,
) -> dict[str, Any]:
    """Reuse on-disk GLB/STEP when present; only crawl McMaster for missing PNs.

    Catalog parts are worker inputs (VibeCAD ``inputs[hw_*]``, Jake ``read_step``).
    They are never injected into the live Three.js viewport.
    """
    pn = normalize_part_number(part_number)
    if library_has_part(project_path, pn):
        push_mcmaster_progress(
            progress_callback,
            project_path,
            stage="hardware",
            pct=22,
            label=f"McMaster · {pn} already on server",
        )
        return fetch_part_for_project(project_path, pn)
    push_mcmaster_progress(
        progress_callback,
        project_path,
        stage="hardware",
        pct=20,
        label=f"McMaster · fetching {pn} STEP on the server…",
    )
    result = fetch_part_for_project(project_path, pn)
    push_mcmaster_progress(
        progress_callback,
        project_path,
        stage="hardware",
        pct=22,
        label=f"McMaster · {pn} on the server",
    )
    return result


def _crawl_download_cad(
    part_number: str,
    dest_dir: Path,
    *,
    on_retry: RetryCb = None,
    session: Any | None = None,
    search_query: str = "",
    max_attempts: int | None = None,
) -> dict[str, Any]:
    """Headless Chromium: open the product page and save 3-D STEP onto dest_dir."""
    dest_dir = Path(dest_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)
    last_exc: BaseException | None = None
    attempts = max(1, int(max_attempts if max_attempts is not None else _FETCH_ATTEMPTS))
    for attempt in range(1, attempts + 1):
        try:
            if session is not None:
                return session.download_part(
                    part_number,
                    dest_dir,
                    settle_ms=_NAV_SETTLE_MS,
                    search_query=search_query,
                )
            with _FETCH_GATE:
                return _crawl_download_cad_locked(
                    part_number,
                    dest_dir,
                    settle_ms=_NAV_SETTLE_MS,
                    search_query=search_query,
                )
        except McMasterCatalogMiss:
            raise
        except Exception as exc:
            last_exc = exc
            if attempt >= attempts or not _is_retryable_fetch_error(exc):
                raise
            logger.warning(
                "McMaster crawl retry %s/%s for %s: %s",
                attempt + 1,
                attempts,
                part_number,
                exc,
            )
            if on_retry:
                try:
                    on_retry(attempt + 1, attempts, exc)
                except Exception:
                    pass
    assert last_exc is not None
    raise last_exc


def _launch_mcmaster_context(playwright: Any) -> tuple[Any, Any]:
    browser = playwright.chromium.launch(
        headless=True,
        args=[
            "--disable-blink-features=AutomationControlled",
            "--no-sandbox",
        ],
    )
    context = browser.new_context(
        accept_downloads=True,
        user_agent=USER_AGENT,
        locale="en-US",
        viewport={"width": 1400, "height": 900},
    )
    try:
        context.add_cookies(
            [
                {
                    "name": "CAD3DDNLD",
                    "value": "STEP",
                    "url": "https://www.mcmaster.com/",
                }
            ]
        )
    except Exception:
        pass
    return browser, context


class _McMasterSession:
    """One Chromium process reused across many PNs on a worker thread."""

    def __enter__(self) -> "_McMasterSession":
        try:
            from playwright.sync_api import sync_playwright
        except ImportError as exc:
            raise RuntimeError(
                "McMaster server fetch needs Playwright. "
                "Install playwright and run `python -m playwright install chromium`."
            ) from exc
        self._mgr = sync_playwright()
        self._playwright = self._mgr.__enter__()
        _FETCH_GATE.acquire()
        self._gate_held = True
        try:
            self._browser, self.context = _launch_mcmaster_context(self._playwright)
        except Exception:
            _FETCH_GATE.release()
            self._gate_held = False
            raise
        return self

    def __exit__(self, *exc: Any) -> None:
        try:
            try:
                self.context.close()
            except Exception:
                pass
            try:
                self._browser.close()
            except Exception:
                pass
        finally:
            if getattr(self, "_gate_held", False):
                try:
                    _FETCH_GATE.release()
                except Exception:
                    pass
            self._mgr.__exit__(*exc)

    def download_part(
        self,
        part_number: str,
        dest_dir: Path,
        *,
        settle_ms: int,
        search_query: str = "",
    ) -> dict[str, Any]:
        return _crawl_download_cad_locked(
            part_number,
            dest_dir,
            settle_ms=settle_ms,
            search_query=search_query,
            context=self.context,
        )


def _crawl_download_cad_locked(
    part_number: str,
    dest_dir: Path,
    *,
    settle_ms: int = _NAV_SETTLE_MS,
    search_query: str = "",
    context: Any | None = None,
) -> dict[str, Any]:
    try:
        from playwright.sync_api import TimeoutError as PlaywrightTimeout
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise RuntimeError(
            "McMaster server fetch needs Playwright. "
            "Install playwright and run `python -m playwright install chromium`."
        ) from exc

    original_pn = normalize_part_number(part_number)
    url = product_url(original_pn)
    title = ""
    used_pn = original_pn
    substituted_from = ""
    owns_browser = context is None
    playwright_cm = None
    browser = None

    if owns_browser:
        playwright_cm = sync_playwright()
        playwright = playwright_cm.__enter__()
        browser, context = _launch_mcmaster_context(playwright)

    page = context.new_page()
    cad_hits: list[str] = []

    def _on_response(response: Any) -> None:
        try:
            href = str(response.url or "")
            low = href.lower()
            if any(
                tok in low
                for tok in (".step", ".stp", "/cad/", "library/cad", "3d-model", "cad3d")
            ):
                cad_hits.append(href)
            ctype = (response.headers or {}).get("content-type", "").lower()
            if "step" in ctype or "x-step" in ctype:
                cad_hits.append(href)
        except Exception:
            pass

    page.on("response", _on_response)
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=_NAV_TIMEOUT_MS)
        used_pn, substituted_from = _resolve_product_or_substitute(
            page,
            original_pn,
            search_query=search_query,
        )
        url = product_url(used_pn)
        page.wait_for_timeout(max(50, int(settle_ms)))
        title = (page.title() or "").strip()
        _dismiss_dialogs(page)
        _open_cad_section(page)
        _dismiss_dialogs(page)
        saved = _try_download_step(page, dest_dir, used_pn)
        if saved is None:
            saved = _try_intercept_cad(page, cad_hits, dest_dir, used_pn)
        if saved is None:
            alt = _substitute_after_step_miss(
                page, used_pn, search_query=search_query or title
            )
            if alt and normalize_part_number(alt) != normalize_part_number(used_pn):
                logger.info(
                    "McMaster %s has no STEP — trying similar part %s",
                    used_pn,
                    alt,
                )
                if not substituted_from:
                    substituted_from = original_pn
                used_pn = normalize_part_number(alt)
                url = product_url(used_pn)
                cad_hits.clear()
                page.goto(url, wait_until="domcontentloaded", timeout=_NAV_TIMEOUT_MS)
                try:
                    _wait_for_product_page(page, used_pn, timeout_ms=_PRODUCT_HYDRATE_MS)
                except McMasterCatalogMiss:
                    alt = ""
                if alt:
                    page.wait_for_timeout(max(50, int(settle_ms)))
                    title = (page.title() or "").strip()
                    _dismiss_dialogs(page)
                    _open_cad_section(page)
                    _dismiss_dialogs(page)
                    saved = _try_download_step(page, dest_dir, used_pn)
                    if saved is None:
                        saved = _try_intercept_cad(page, cad_hits, dest_dir, used_pn)
        if saved is None:
            raise RuntimeError(
                f"McMaster page for {used_pn} loaded but no 3-D STEP download started. "
                f"Buy URL: {url}"
            )
    except PlaywrightTimeout as exc:
        raise RuntimeError(f"Timed out opening McMaster {original_pn} ({url})") from exc
    finally:
        try:
            page.close()
        except Exception:
            pass
        if owns_browser:
            try:
                context.close()
            except Exception:
                pass
            try:
                if browser is not None:
                    browser.close()
            except Exception:
                pass
            if playwright_cm is not None:
                playwright_cm.__exit__(None, None, None)

    unpacked = _unpack_if_zip(Path(saved), dest_dir, used_pn)
    suffix = Path(unpacked).suffix.lower()
    if suffix == ".zip":
        raise RuntimeError(
            f"McMaster page for {used_pn} downloaded an archive with no STEP inside. "
            f"Buy URL: {url}"
        )
    if suffix in _SOLIDWORKS_SUFFIXES:
        raise RuntimeError(
            f"McMaster page for {used_pn} downloaded SolidWorks {Path(unpacked).name} "
            f"instead of 3-D STEP. Buy URL: {url}"
        )
    return {
        "path": str(unpacked),
        "page_url": url,
        "title": _clean_title(title, used_pn),
        "part_number": used_pn,
        "substituted_from": substituted_from,
    }


def _page_body_text(page: Any) -> str:
    try:
        return str(page.inner_text("body") or "")
    except Exception:
        try:
            return str(page.content() or "")
        except Exception:
            return ""


def _extract_pns_from_page(page: Any, *, exclude: str = "") -> list[str]:
    hrefs: list[str] = []
    try:
        hrefs = page.eval_on_selector_all(
            "a[href]",
            "els => els.map(a => a.getAttribute('href') || '')",
        ) or []
    except Exception:
        hrefs = []
    return extract_product_pns("\n".join(str(h) for h in hrefs), exclude=exclude)


def _pick_live_substitute(page: Any, original_pn: str, candidates: list[str]) -> str | None:
    """Open candidate product pages until one hydrates. Prefer the same McMaster family."""
    ranked = _same_family_pns(candidates, original_pn) or [
        item for item in candidates if item != normalize_part_number(original_pn)
    ]
    for alt in ranked[:_MAX_SUBSTITUTE_CANDIDATES]:
        try:
            page.goto(product_url(alt), wait_until="domcontentloaded", timeout=_NAV_TIMEOUT_MS)
            _wait_for_product_page(page, alt, timeout_ms=_SUBSTITUTE_HYDRATE_MS)
            body = _page_body_text(page)
            if page_has_no_results(body) or not _page_looks_like_product(page):
                continue
            return alt
        except Exception:
            continue
    return None


def _search_substitute_on_page(page: Any, query: str, original_pn: str) -> str | None:
    cleaned = simplify_search_query(query, original_pn=original_pn) or str(query or "").strip()
    if not cleaned:
        return None
    urls: list[str] = []
    fam = family_prefix(original_pn)
    if fam and cleaned.lower() == fam.lower():
        urls.append(product_url(fam))
    urls.append(search_url(cleaned))
    seen: set[str] = set()
    for url in urls:
        if not url or url in seen:
            continue
        seen.add(url)
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=_NAV_TIMEOUT_MS)
            page.wait_for_timeout(150)
        except Exception:
            continue
        body = _page_body_text(page)
        if page_has_no_results(body):
            tokens = cleaned.split()
            if len(tokens) > 3:
                try:
                    page.goto(
                        search_url(" ".join(tokens[:3])),
                        wait_until="domcontentloaded",
                        timeout=_NAV_TIMEOUT_MS,
                    )
                    page.wait_for_timeout(150)
                except Exception:
                    continue
                if page_has_no_results(_page_body_text(page)):
                    continue
            else:
                continue
        alts = _extract_pns_from_page(page, exclude=original_pn)
        picked = _pick_live_substitute(page, original_pn, alts) if alts else None
        if picked:
            return picked
    return None


def _resolve_product_or_substitute(
    page: Any,
    part_number: str,
    *,
    search_query: str = "",
) -> tuple[str, str]:
    """Return (pn_to_download, original_pn_if_substituted)."""
    try:
        _wait_for_product_page(page, part_number, timeout_ms=_PRODUCT_HYDRATE_MS)
        body = _page_body_text(page)
        if page_has_no_results(body) or not _page_looks_like_product(page):
            raise McMasterCatalogMiss(
                f"McMaster has no product page for {part_number} (not in catalog). "
                f"Buy URL: {product_url(part_number)}"
            )
        return part_number, ""
    except McMasterCatalogMiss:
        same_page = _same_family_pns(_extract_pns_from_page(page, exclude=part_number), part_number)
        alt = _pick_live_substitute(page, part_number, same_page) if same_page else None
        if not alt:
            for query in substitute_search_queries(search_query, part_number):
                alt = _search_substitute_on_page(page, query, part_number)
                if alt:
                    break
        if not alt:
            fam = family_prefix(part_number)
            if fam:
                alt = _search_substitute_on_page(page, fam, part_number)
        if not alt:
            raise McMasterCatalogMiss(
                f"McMaster has no product page for {part_number} (not in catalog · no substitute). "
                f"Buy URL: {product_url(part_number)}"
            )
        logger.info("McMaster %s missing — using substitute %s", part_number, alt)
        current = str(page.url or "")
        if not re.search(rf"/{re.escape(alt)}(?:/|$|\?|#)", current, re.I):
            page.goto(product_url(alt), wait_until="domcontentloaded", timeout=_NAV_TIMEOUT_MS)
            try:
                _wait_for_product_page(page, alt, timeout_ms=_PRODUCT_HYDRATE_MS)
            except McMasterCatalogMiss as exc:
                raise McMasterCatalogMiss(
                    f"McMaster has no product page for {part_number} (not in catalog · no substitute). "
                    f"Buy URL: {product_url(part_number)}"
                ) from exc
        return alt, part_number


def _substitute_after_step_miss(
    page: Any, part_number: str, *, search_query: str = ""
) -> str | None:
    """When the product page has no 3-D STEP, pick a similar catalog part that does."""
    queries = substitute_search_queries(search_query, part_number)
    fam = family_prefix(part_number)
    if fam and fam not in queries:
        queries.append(fam)
    for query in queries:
        alt = _search_substitute_on_page(page, query, part_number)
        if alt:
            return alt
    return None


def _page_looks_like_product(page: Any) -> bool:
    try:
        body = _page_body_text(page)
    except Exception:
        body = ""
    return bool(re.search(r"Product CAD|Add to Order|Add To Order|3-D STEP|3-D Solidworks", body, re.I))


def _wait_for_product_page(page: Any, part_number: str, *, timeout_ms: int) -> None:
    """Fail fast when McMaster never hydrates a product (bad/discontinued PN)."""
    try:
        page.wait_for_function(
            """() => {
              const title = (document.title || "").trim();
              if (title && title !== "McMaster-Carr") return true;
              const body = (document.body && document.body.innerText) || "";
              return /Product CAD|Add to Order|Add To Order|3-D Solidworks|3-D STEP|no results|couldn't find/i.test(body);
            }""",
            timeout=max(1_200, int(timeout_ms)),
        )
    except Exception as exc:
        title = ""
        try:
            title = (page.title() or "").strip()
        except Exception:
            title = ""
        if title and title != "McMaster-Carr":
            return
        raise McMasterCatalogMiss(
            f"McMaster has no product page for {part_number} (not in catalog). "
            f"Buy URL: {product_url(part_number)}"
        ) from exc
    body = _page_body_text(page)
    if page_has_no_results(body):
        raise McMasterCatalogMiss(
            f"McMaster has no product page for {part_number} (not in catalog). "
            f"Buy URL: {product_url(part_number)}"
        )


def _dismiss_dialogs(page: Any) -> None:
    for spec in (
        "button:has-text('Accept All')",
        "button:has-text('Accept')",
        "button:has-text('I Agree')",
        "button:has-text('I Understand')",
        "button:has-text('Agree')",
        "button:has-text('Continue')",
        "button:has-text('Download File')",
        "text=Accept All",
    ):
        try:
            loc = page.locator(spec).first
            if loc.count() and loc.is_visible():
                loc.click(timeout=800)
        except Exception:
            continue


def _open_cad_section(page: Any) -> None:
    """Expand Product CAD and wait until the format picker or download link hydrates."""
    for spec in (
        "button:has-text('Product CAD')",
        "a:has-text('Product CAD')",
        "button:has-text('CAD Files')",
        "[aria-label*='Product CAD' i]",
        "text=Product CAD",
    ):
        try:
            loc = page.locator(spec).first
            if not loc.count():
                continue
            loc.scroll_into_view_if_needed(timeout=1500)
            if loc.is_visible():
                loc.click(timeout=1500)
                break
        except Exception:
            continue
    try:
        page.wait_for_selector(
            "button[role='combobox'], a[href*='Library/CAD' i], a[href*='.STEP' i], "
            "button.button-save, button:has-text('Download')",
            timeout=_CAD_SECTION_TIMEOUT_MS,
        )
    except Exception:
        pass
    page.wait_for_timeout(120)


def _promote_to_step(src: Path, project_path: Path) -> Path:
    """If the crawler saved Parasolid/SAT, convert to STEP. Skip native SolidWorks."""
    src = Path(src)
    if src.suffix.lower() in _STEP_SUFFIXES:
        return src
    from backend.services.cad_proprietary_convert import (
        FUSION_NATIVE_SUFFIXES,
        SOLIDWORKS_SUFFIXES,
        try_convert_proprietary_cad,
    )

    if src.suffix.lower() in SOLIDWORKS_SUFFIXES | FUSION_NATIVE_SUFFIXES:
        logger.warning(
            "McMaster saved %s instead of STEP — viewport cannot open SolidWorks natives",
            src.name,
        )
        return src
    converted = try_convert_proprietary_cad(src, project_path)
    if not converted or not converted.get("path"):
        logger.warning("McMaster CAD %s is not STEP and could not be converted", src.name)
        return src
    out = Path(converted["path"])
    if out.suffix.lower() not in _STEP_SUFFIXES:
        return out
    preferred = project_path / f"{src.stem}.step"
    if out.resolve() != preferred.resolve():
        try:
            shutil.copy2(out, preferred)
            return preferred
        except OSError:
            return out
    return out


def _looks_like_msi_or_ole(path: Path) -> bool:
    try:
        head = Path(path).read_bytes()[:8]
    except OSError:
        return False
    return head.startswith(b"\xd0\xcf\x11\xe0")


def _save_playwright_download(download: Any, dest_dir: Path, part_number: str) -> Path | None:
    suggested = Path(download.suggested_filename or "")
    suffix = suggested.suffix.lower()
    tmp = dest_dir / f"{part_number}.download"
    download.save_as(str(tmp))
    if not tmp.is_file() or tmp.stat().st_size < 200:
        return None
    if _looks_like_msi_or_ole(tmp):
        logger.warning(
            "McMaster download for %s was an installer (%s), not CAD — skipping",
            part_number,
            suggested.name or tmp.name,
        )
        tmp.unlink(missing_ok=True)
        return None
    if zipfile.is_zipfile(tmp):
        dest = dest_dir / f"{part_number}.zip"
        tmp.replace(dest)
        return dest
    if cad_service.looks_like_step_file(tmp):
        dest = dest_dir / f"{part_number}.step"
        tmp.replace(dest)
        return dest
    if suffix in _SOLIDWORKS_SUFFIXES:
        logger.warning(
            "McMaster download for %s was SolidWorks (%s), not STEP — skipping",
            part_number,
            suggested.name or tmp.name,
        )
        tmp.unlink(missing_ok=True)
        return None
    if suffix in _CONVERTIBLE_CAD_SUFFIXES:
        dest = dest_dir / f"{part_number}{suffix}"
        tmp.replace(dest)
        return dest
    logger.warning(
        "McMaster download for %s has unknown type (suggested %s, %s bytes)",
        part_number,
        suggested.name or "?",
        tmp.stat().st_size,
    )
    tmp.unlink(missing_ok=True)
    return None


def _write_cad_bytes(body: bytes, dest_dir: Path, part_number: str, hinted: str = "") -> Path | None:
    if not body or len(body) < 200 or body.startswith(b"\xd0\xcf\x11\xe0"):
        return None
    tmp = dest_dir / f"{part_number}.download"
    tmp.write_bytes(body)
    if zipfile.is_zipfile(tmp):
        dest = dest_dir / f"{part_number}.zip"
        tmp.replace(dest)
        return dest
    if cad_service.looks_like_step_file(tmp):
        dest = dest_dir / f"{part_number}.step"
        tmp.replace(dest)
        return dest
    suffix = Path(str(hinted).split("?")[0]).suffix.lower()
    if suffix in _SOLIDWORKS_SUFFIXES or _href_looks_like_solidworks(hinted):
        tmp.unlink(missing_ok=True)
        return None
    if suffix in _CONVERTIBLE_CAD_SUFFIXES:
        dest = dest_dir / f"{part_number}{suffix}"
        tmp.replace(dest)
        return dest
    tmp.unlink(missing_ok=True)
    return None


def _try_download_step(page: Any, dest_dir: Path, part_number: str) -> Path | None:
    """Open the CAD format combobox, pick 3-D STEP, then GET that Library/CAD file."""
    _select_step_format(page)
    dest = _download_cad_library_href(page, dest_dir, part_number)
    if dest is not None and dest.suffix.lower() in _CONVERTIBLE_CAD_SUFFIXES | {".zip"}:
        return dest

    download_selectors = [
        "a[href*='.STEP' i]",
        "a[href*='.STP' i]",
        "a[href*='.step']",
        "a[href*='.stp']",
        "a[href*='Library/CAD' i]",
        "a[class*='downloadAnchor' i]",
        "button:has-text('Download')",
        ".button-save--sidebyside",
        ".button-save--stacked",
        "button.button-save",
        "button:has-text('Save')",
    ]
    clicked = False
    try:
        expect_download = getattr(page.context, "expect_download", page.expect_download)
        with expect_download(timeout=_DOWNLOAD_TIMEOUT_MS) as pending:
            clicked = _click_first(page, download_selectors, timeout_ms=1200)
            if not clicked:
                raise RuntimeError("no download control")
            _dismiss_dialogs(page)
        dest = _save_playwright_download(pending.value, dest_dir, part_number)
        if dest is not None and dest.suffix.lower() in _CONVERTIBLE_CAD_SUFFIXES | {".zip"}:
            return dest
    except Exception:
        return None
    return None


def _select_step_format(page: Any) -> None:
    """Open McMaster's CAD combobox and pick '3-D STEP' (not SolidWorks)."""
    _click_first(
        page,
        [
            "button[role='combobox']",
            "button:has-text('3-D Solidworks')",
            "button:has-text('3-D SolidWorks')",
            "button:has-text('3-D STEP')",
            "button:has-text('3-D')",
            "[role='combobox']",
        ],
        timeout_ms=1200,
    )
    try:
        page.wait_for_selector("[role='listbox'] [role='option']", timeout=1_500)
    except Exception:
        pass
    picked = False
    for label in ("3-D STEP", "3-D SAT", "3-D IGES"):
        try:
            loc = page.locator("li[role='option']").filter(has_text=re.compile(rf"^{re.escape(label)}$", re.I))
            if loc.count():
                loc.first.click(timeout=2000)
                logger.info("McMaster CAD format picker: %s", label)
                picked = True
                break
        except Exception:
            continue
    if not picked:
        try:
            opt = page.get_by_role("option", name=re.compile(r"3-?\s*D\s*STEP", re.I))
            if opt.count():
                opt.first.click(timeout=2000)
                logger.info("McMaster CAD format picker: option 3-D STEP")
                picked = True
        except Exception:
            pass
    if picked:
        try:
            page.wait_for_function(
                """() => {
                  const links = Array.from(document.querySelectorAll("a[href]"));
                  return links.some((a) => /\\.(step|stp|sat|iges|igs)(?:$|[/?#])/i.test(a.getAttribute("href") || ""));
                }""",
                timeout=2_000,
            )
        except Exception:
            page.wait_for_timeout(120)
        return
    page.wait_for_timeout(80)


def _download_cad_library_href(page: Any, dest_dir: Path, part_number: str) -> Path | None:
    """GET the Product CAD Library/CAD2 link after STEP is selected."""
    from urllib.parse import urljoin

    href = ""
    try:
        step_loc = page.locator(
            "a[href*='.STEP' i], a[href*='.STP' i], a[href*='.step'], a[href*='.stp']"
        ).first
        if step_loc.count():
            href = step_loc.get_attribute("href") or ""
    except Exception:
        href = ""
    if not href:
        for spec in ("a[href*='Library/CAD' i]", "a[href*='/library/cad' i]"):
            try:
                loc = page.locator(spec).first
                if loc.count():
                    href = loc.get_attribute("href") or ""
                    if href and not _href_looks_like_solidworks(href):
                        break
                    href = ""
            except Exception:
                href = ""
    if not href or _href_looks_like_solidworks(href):
        return None
    try:
        response = page.request.get(urljoin(page.url, href), timeout=_DOWNLOAD_TIMEOUT_MS)
        if not response.ok:
            return None
        dest = _write_cad_bytes(response.body(), dest_dir, part_number, hinted=href)
        if dest is not None and dest.suffix.lower() in _SOLIDWORKS_SUFFIXES:
            dest.unlink(missing_ok=True)
            return None
        return dest
    except Exception as exc:
        logger.debug("McMaster CAD href fetch failed for %s: %s", part_number, exc)
    return None


def _click_first(page: Any, selectors: list[str], *, timeout_ms: int) -> bool:
    for spec in selectors:
        try:
            loc = page.locator(spec).first
            if not loc.count():
                continue
            try:
                loc.wait_for(state="visible", timeout=min(int(timeout_ms), 800))
            except Exception:
                if not loc.count() or not loc.is_visible():
                    continue
            label = ""
            href = ""
            try:
                label = (loc.inner_text() or "").strip().lower()
            except Exception:
                label = ""
            try:
                href = (loc.get_attribute("href") or "").lower()
            except Exception:
                href = ""
            if "solidworksaddin" in href or "add-in" in label or "add in" in label:
                continue
            if _href_looks_like_solidworks(href):
                continue
            loc.scroll_into_view_if_needed(timeout=1500)
            loc.click(timeout=timeout_ms)
            return True
        except Exception:
            continue
    return False


def _try_intercept_cad(page: Any, cad_hits: list[str], dest_dir: Path, part_number: str) -> Path | None:
    seen: set[str] = set()
    for href in cad_hits:
        if href in seen:
            continue
        seen.add(href)
        if _href_looks_like_solidworks(href):
            continue
        low = href.lower()
        if not any(
            tok in low for tok in (".step", ".stp", ".zip", ".sat", "library/cad", "cad3d")
        ):
            continue
        try:
            response = page.request.get(href, timeout=_DOWNLOAD_TIMEOUT_MS)
            if not response.ok:
                continue
            dest = _write_cad_bytes(response.body(), dest_dir, part_number, hinted=href)
            if dest is not None:
                return dest
        except Exception:
            continue
    return None


def _unpack_if_zip(path: Path, dest_dir: Path, part_number: str) -> Path:
    if path.suffix.lower() != ".zip" and not zipfile.is_zipfile(path):
        return path
    try:
        with zipfile.ZipFile(path) as zf:
            members = [
                info
                for info in zf.infolist()
                if not info.is_dir()
                and Path(info.filename).suffix.lower() in _CONVERTIBLE_CAD_SUFFIXES
            ]
            if not members:
                return path
            members.sort(key=lambda i: (Path(i.filename).suffix.lower() not in {".step", ".stp"}, i.file_size))
            pick = members[0]
            suffix = Path(pick.filename).suffix.lower() or ".step"
            out = dest_dir / f"{part_number}{suffix}"
            out.write_bytes(zf.read(pick))
            return out
    except zipfile.BadZipFile:
        return path


def _clean_title(raw: str, part_number: str) -> str:
    text = re.sub(r"\s+", " ", str(raw or "")).strip()
    text = re.sub(r"^\s*McMaster-Carr\s*[|–-]\s*", "", text, flags=re.I)
    text = re.sub(rf"\b{re.escape(part_number)}\b", "", text, flags=re.I).strip(" |-–")
    return text[:120]
