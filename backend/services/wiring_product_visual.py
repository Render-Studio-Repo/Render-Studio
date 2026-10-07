"""Turn product-page photos into compact SVG silhouettes for the wiring canvas."""

from __future__ import annotations

import io
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from backend.services.url_document_service import (
    _BROWSER_UA,
    _is_blocked_host,
    amazon_asin,
    clean_url,
)

MAX_IMAGE_BYTES = 2_500_000
MAX_EDGE = 160
MIN_BLOB = 90
MAX_PATHS = 7
FETCH_TIMEOUT_SEC = 12

TYPE_HINTS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"uln2003|a4988|drv8825|tb6600|cl86|l298|l293|motor\s*hat|robot\s*hat|gpio\s*hat|motor\s*driver|h[\s\-]?bridge", re.I), "motor-driver"),
    (re.compile(r"28byj|nema\s*\d|stepper", re.I), "stepper"),
    (re.compile(r"sg90|mg90|mg996|\bservo\b", re.I), "servo-motor"),
    (re.compile(r"power\s*supply|wall\s*wart|switching\s*power|ac[\s/]*dc|adapter|\bpsu\b|transformer", re.I), "power-supply"),
    (re.compile(r"raspberry|\brpi\b|\bpi[\s\-]?[345]|bcm271", re.I), "raspberry-pi"),
    (re.compile(r"mks\s*gen|makerbase|\bramps\b", re.I), "arduino-mega"),
    (re.compile(r"arduino\s*mega|atmega2560", re.I), "arduino-mega"),
    (re.compile(r"arduino|seeeduino|\buno\b|\bnano\b", re.I), "arduino-uno"),
    (re.compile(r"gear\s*motor|dc\s*motor|tt\s*motor|\bmotor\b", re.I), "motor"),
    (re.compile(r"\bled\b|neopixel", re.I), "led"),
    (re.compile(r"breadboard", re.I), "breadboard"),
]

SKIP_VISUAL_TYPES = frozenset({"breadboard", "resistor", "transistor", "diode", "button"})


def infer_wiring_type(title: str, url: str = "", driver_key: str | None = None) -> str | None:
    if driver_key:
        return "motor-driver"
    hay = f"{title or ''} {url or ''}"
    for pattern, wiring_type in TYPE_HINTS:
        if pattern.search(hay):
            return wiring_type
    return None


def amazon_image_fallbacks(asin: str) -> list[str]:
    code = (asin or "").strip().upper()
    if not re.fullmatch(r"[A-Z0-9]{10}", code):
        return []
    return [
        f"https://images-na.ssl-images-amazon.com/images/P/{code}.01._SCLZZZZZZZ_.jpg",
        f"https://images-na.ssl-images-amazon.com/images/P/{code}.01.LZZZZZZZ.jpg",
        (
            "https://ws-na.amazon-adsystem.com/widgets/q?"
            f"_encoding=UTF8&MarketPlace=US&ASIN={code}&ServiceVersion=20070822"
            "&ID=AsinImage&WS=1&Format=_SL400_"
        ),
    ]


def fetch_image_bytes(url: str | None) -> bytes | None:
    clean = clean_url(url)
    if not clean:
        raw = str(url or "").strip()
        try:
            parsed = urllib.parse.urlparse(raw)
        except ValueError:
            return None
        if parsed.scheme not in {"http", "https"} or _is_blocked_host(parsed.hostname):
            return None
        clean = raw
    if not clean:
        return None
    req = urllib.request.Request(
        clean,
        headers={
            "User-Agent": _BROWSER_UA,
            "Accept": "image/jpeg,image/png,image/webp,image/*;q=0.9,*/*;q=0.5",
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT_SEC) as resp:
            ctype = (resp.headers.get("content-type") or "").lower()
            if "html" in ctype or "json" in ctype or "text/" in ctype:
                return None
            data = resp.read(MAX_IMAGE_BYTES + 1)
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return None
    if not data or len(data) > MAX_IMAGE_BYTES or len(data) < 200:
        return None
    if data[:20].lstrip().startswith((b"<", b"{", b"<!")):
        return None
    return data


def vectorize_image_bytes(data: bytes) -> dict[str, Any] | None:
    try:
        from PIL import Image
    except Exception:
        return None
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except Exception:
        return None
    image = image.convert("RGBA")
    image.thumbnail((MAX_EDGE, MAX_EDGE), Image.Resampling.LANCZOS)
    width, height = image.size
    if width < 12 or height < 12:
        return None
    pixels = list(image.getdata())
    bg = _background_rgba(pixels, width, height)
    mask = [_is_foreground(px, bg) for px in pixels]
    if sum(1 for flag in mask if flag) < MIN_BLOB:
        return None
    quantized = _quantize_foreground(image, mask, bg)
    layers = _color_layers(quantized, mask, width, height)
    paths: list[dict[str, str]] = []
    for fill, blob in layers:
        for contour in _contours_for_blob(blob, width, height):
            simplified = _rdp(contour, 1.35)
            if len(simplified) < 4:
                continue
            paths.append({"d": _svg_path(simplified), "fill": fill})
            if len(paths) >= MAX_PATHS:
                break
        if len(paths) >= MAX_PATHS:
            break
    if not paths:
        return None
    outline = _largest_silhouette(mask, width, height)
    if outline:
        paths.insert(0, {"d": _svg_path(outline), "fill": "none", "stroke": "#1c2128", "strokeWidth": "1.4"})
        paths = paths[: MAX_PATHS + 1]
    return {
        "viewBox": f"0 0 {width} {height}",
        "paths": paths,
        "width": width,
        "height": height,
    }


def visual_for_analysis(analysis: dict[str, Any] | None) -> dict[str, Any] | None:
    if not analysis:
        return None
    url = str(analysis.get("url") or "")
    title = str(analysis.get("title") or "")
    driver = analysis.get("driver") or {}
    wiring_type = infer_wiring_type(title, url, driver.get("key") if isinstance(driver, dict) else None)
    candidates: list[str] = []
    image = str(analysis.get("image") or "").strip()
    if image:
        candidates.append(image)
    asin = amazon_asin(url)
    for extra in amazon_image_fallbacks(asin):
        if extra not in candidates:
            candidates.append(extra)
    visual = None
    used = ""
    for candidate in candidates[:4]:
        raw = fetch_image_bytes(candidate)
        if not raw:
            continue
        visual = vectorize_image_bytes(raw)
        if visual:
            used = candidate
            break
    if not visual:
        return None
    return {
        **visual,
        "source_url": url,
        "source_title": title,
        "image_url": used,
        "wiring_type": wiring_type,
    }


def attach_product_visuals(
    schematic: dict[str, Any],
    analyses: list[dict[str, Any]] | None,
) -> tuple[dict[str, Any], list[str]]:
    """Match linked product photos onto schematic components as SVG silhouettes."""
    notes: list[str] = []
    components = schematic.get("components") if isinstance(schematic.get("components"), list) else []
    used_ids: set[str] = set()
    attached = 0
    for analysis in analyses or []:
        visual = visual_for_analysis(analysis)
        if not visual:
            continue
        target = _match_component(components, analysis, visual, used_ids)
        if not target:
            continue
        target["visual"] = {
            "viewBox": visual["viewBox"],
            "paths": visual["paths"],
        }
        if visual.get("image_url"):
            target["preview"] = visual["image_url"]
        target["source_url"] = visual.get("source_url") or analysis.get("url")
        if visual.get("source_title"):
            target["source_title"] = visual["source_title"]
        pref_w = max(96, int(visual.get("width") or 96))
        pref_h = max(72, int(visual.get("height") or 72))
        target["w"] = max(int(target.get("w") or 80), min(pref_w, 180))
        target["h"] = max(int(target.get("h") or 56), min(pref_h, 160))
        used_ids.add(str(target.get("id") or ""))
        attached += 1
        label = target.get("label") or target.get("type") or "part"
        notes.append(f"Vectorized {label} from product photo.")
    if attached:
        extra = schematic.get("notes") if isinstance(schematic.get("notes"), list) else []
        schematic["notes"] = [*(extra or []), *notes[:4]]
    return schematic, notes


def _match_component(
    components: list[Any],
    analysis: dict[str, Any],
    visual: dict[str, Any],
    used_ids: set[str],
) -> dict[str, Any] | None:
    url = str(analysis.get("url") or "").rstrip("/")
    title = str(analysis.get("title") or visual.get("source_title") or "").lower()
    wanted = visual.get("wiring_type")
    scored: list[tuple[int, dict[str, Any]]] = []
    for comp in components:
        if not isinstance(comp, dict):
            continue
        cid = str(comp.get("id") or "")
        ctype = str(comp.get("type") or "").lower()
        if not cid or cid in used_ids or ctype in SKIP_VISUAL_TYPES:
            continue
        score = 0
        source = str(comp.get("source_url") or "").rstrip("/")
        if url and source and (source == url or url in source or source in url):
            score += 80
        if wanted and ctype == wanted:
            score += 40
        label = str(comp.get("label") or "").lower()
        tokens = [tok for tok in re.findall(r"[a-z0-9]{3,}", title) if tok not in {"with", "for", "the", "and"}]
        score += sum(6 for tok in tokens[:8] if tok in label)
        if score:
            scored.append((score, comp))
    if not scored:
        for comp in components:
            if not isinstance(comp, dict):
                continue
            cid = str(comp.get("id") or "")
            ctype = str(comp.get("type") or "").lower()
            if cid and cid not in used_ids and wanted and ctype == wanted:
                return comp
        return None
    scored.sort(key=lambda item: item[0], reverse=True)
    return scored[0][1]


def _background_rgba(pixels: list[tuple[int, int, int, int]], width: int, height: int) -> tuple[int, int, int, int]:
    corners = [
        pixels[0],
        pixels[width - 1],
        pixels[(height - 1) * width],
        pixels[-1],
    ]
    samples = []
    for y in (0, 1, height - 2, height - 1):
        for x in (0, 1, width - 2, width - 1):
            if 0 <= x < width and 0 <= y < height:
                samples.append(pixels[y * width + x])
    pool = samples or corners
    r = sum(p[0] for p in pool) // len(pool)
    g = sum(p[1] for p in pool) // len(pool)
    b = sum(p[2] for p in pool) // len(pool)
    a = sum(p[3] for p in pool) // len(pool)
    return (r, g, b, a)


def _is_foreground(px: tuple[int, int, int, int], bg: tuple[int, int, int, int]) -> bool:
    if px[3] < 28:
        return False
    dr = px[0] - bg[0]
    dg = px[1] - bg[1]
    db = px[2] - bg[2]
    dist = dr * dr + dg * dg + db * db
    luma = 0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2]
    bg_luma = 0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2]
    if bg_luma > 210 and luma > 242 and dist < 1400:
        return False
    return dist > 900 or px[3] < bg[3] - 40


def _quantize_foreground(image, mask: list[bool], bg: tuple[int, int, int, int]):
    from PIL import Image

    work = image.copy()
    pixels = list(work.getdata())
    for i, flag in enumerate(mask):
        if not flag:
            pixels[i] = (bg[0], bg[1], bg[2], 0)
    work.putdata(pixels)
    rgb = work.convert("RGB")
    try:
        quantized = rgb.quantize(colors=5, method=Image.Quantize.MEDIANCUT)
        converted = quantized.convert("RGB")
    except Exception:
        converted = rgb
    return converted, [], mask


def _color_layers(quantized_pack, mask: list[bool], width: int, height: int) -> list[tuple[str, list[bool]]]:
    converted, _palette, _mask = quantized_pack
    pixels = list(converted.getdata())
    buckets: dict[tuple[int, int, int], list[int]] = {}
    for i, flag in enumerate(mask):
        if not flag:
            continue
        key = pixels[i]
        buckets.setdefault(key, []).append(i)
    ranked = sorted(buckets.items(), key=lambda item: len(item[1]), reverse=True)
    layers: list[tuple[str, list[bool]]] = []
    for color, indexes in ranked[:5]:
        if len(indexes) < MIN_BLOB:
            continue
        blob = [False] * (width * height)
        for i in indexes:
            blob[i] = True
        layers.append((_rgb_hex(color), blob))
    return layers


def _rgb_hex(color: tuple[int, int, int]) -> str:
    return f"#{color[0]:02x}{color[1]:02x}{color[2]:02x}"


def _largest_silhouette(mask: list[bool], width: int, height: int) -> list[tuple[float, float]] | None:
    contours = _contours_for_blob(mask, width, height)
    if not contours:
        return None
    best = max(contours, key=len)
    return _rdp(best, 1.2)


def _contours_for_blob(mask: list[bool], width: int, height: int) -> list[list[tuple[float, float]]]:
    contours: list[list[tuple[float, float]]] = []
    for blob in _connected_components(mask, width, height)[:4]:
        start = min(
            ((idx % width, idx // width) for idx in blob),
            key=lambda pt: (pt[0], pt[1]),
        )
        contour = _trace_contour(mask, width, height, start[0], start[1])
        if len(contour) >= 8:
            contours.append(contour)
    return contours


def _connected_components(mask: list[bool], width: int, height: int) -> list[list[int]]:
    visited = [False] * (width * height)
    components: list[list[int]] = []
    for start, flag in enumerate(mask):
        if not flag or visited[start]:
            continue
        stack = [start]
        visited[start] = True
        cells = [start]
        while stack:
            idx = stack.pop()
            x = idx % width
            y = idx // width
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if nx < 0 or ny < 0 or nx >= width or ny >= height:
                    continue
                nidx = ny * width + nx
                if mask[nidx] and not visited[nidx]:
                    visited[nidx] = True
                    stack.append(nidx)
                    cells.append(nidx)
        if len(cells) >= MIN_BLOB:
            components.append(cells)
    components.sort(key=len, reverse=True)
    return components


def _trace_contour(mask: list[bool], width: int, height: int, start_x: int, start_y: int) -> list[tuple[float, float]]:
    neighbors = ((1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1))
    contour: list[tuple[float, float]] = [(float(start_x), float(start_y))]
    x, y = start_x, start_y
    incoming = 0
    for _ in range(width * height):
        start_dir = (incoming + 6) % 8
        found = False
        for step in range(8):
            direction = (start_dir + step) % 8
            dx, dy = neighbors[direction]
            nx, ny = x + dx, y + dy
            if 0 <= nx < width and 0 <= ny < height and mask[ny * width + nx]:
                x, y = nx, ny
                incoming = direction
                found = True
                break
        if not found:
            break
        contour.append((float(x), float(y)))
        if x == start_x and y == start_y and len(contour) > 4:
            break
    return contour


def _rdp(points: list[tuple[float, float]], epsilon: float) -> list[tuple[float, float]]:
    if len(points) < 3:
        return points
    start, end = points[0], points[-1]
    max_dist = -1.0
    index = 0
    for i in range(1, len(points) - 1):
        dist = _perp_dist(points[i], start, end)
        if dist > max_dist:
            index = i
            max_dist = dist
    if max_dist > epsilon:
        left = _rdp(points[: index + 1], epsilon)
        right = _rdp(points[index:], epsilon)
        return left[:-1] + right
    return [start, end]


def _perp_dist(point: tuple[float, float], start: tuple[float, float], end: tuple[float, float]) -> float:
    x, y = point
    x1, y1 = start
    x2, y2 = end
    dx = x2 - x1
    dy = y2 - y1
    if dx == 0 and dy == 0:
        return ((x - x1) ** 2 + (y - y1) ** 2) ** 0.5
    return abs(dy * x - dx * y + x2 * y1 - y2 * x1) / ((dx * dx + dy * dy) ** 0.5)


def _svg_path(points: list[tuple[float, float]]) -> str:
    if not points:
        return ""
    parts = [f"M{_fmt(points[0][0])} {_fmt(points[0][1])}"]
    for x, y in points[1:]:
        parts.append(f"L{_fmt(x)} {_fmt(y)}")
    parts.append("Z")
    return " ".join(parts)


def _fmt(value: float) -> str:
    text = f"{value:.1f}"
    if text.endswith(".0"):
        return text[:-2]
    return text
