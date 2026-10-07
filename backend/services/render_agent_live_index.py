"""Lightweight live Updates + shortcuts context for Render Agent.

Reads already-published artifacts only (a few KB of JSON / one milestones file).
No repo crawl, no embeddings, no watchers. In-memory cache keyed by mtime.
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
SHIPPED_JSON = FRONTEND / "docs" / "updates" / "shipped.json"
MILESTONES_JS = FRONTEND / "docs" / "updates" / "milestones.js"
UPDATES_INDEX = FRONTEND / "docs" / "agent" / "updates-index.json"
SHORTCUTS_JSON = FRONTEND / "docs" / "agent" / "shortcuts.json"
CANVAS_JS = FRONTEND / "viewport" / "canvas-mode.js"
SKETCH_JS = FRONTEND / "components" / "sketch-editor.js"

TTL_SEC = 90.0
MAX_UPDATES = 80
MAX_WHAT_NEW = 28
MAX_MATCHED_UPDATES = 8
MAX_BLOCK_CHARS = 12000

WHAT_NEW_RE = re.compile(
    r"\b(what'?s new|whats new|recent updates?|changelog|just shipped|just added|"
    r"latest (feature|update|tool)s?|what (changed|shipped)|new in (studio|render)|"
    r"release notes|updates page)\b",
    re.I,
)
SHORTCUT_INTENT_RE = re.compile(
    r"\b(shortcuts?|hotkeys?|hot keys?|keybinds?|key bindings?|keyboard|"
    r"what key|which key|key for|press(?:es|ing)?\b|accelerator)\b",
    re.I,
)
HOW_RE = re.compile(r"\b(how do i|how to|where is|where do i|what does)\b", re.I)
_JS_MAP_RE = re.compile(
    r"const\s+(shortcuts|SKETCH_SHORTCUTS|SHIFT_SKETCH_SHORTCUTS)\s*=\s*\{([^}]+)\}"
)
_MILESTONE_SPLIT = re.compile(r"\n  \},\n")

_cache: dict[str, Any] = {"key": None, "at": 0.0, "payload": None}


def _site_pages_path() -> Path:
    try:
        from backend.config import settings

        return Path(settings.data_dir) / "site_pages.json"
    except Exception:
        return ROOT / "data" / "site_pages.json"


def _mtime_size(path: Path) -> tuple[int, int]:
    try:
        st = path.stat()
        return int(st.st_mtime_ns), int(st.st_size)
    except OSError:
        return (0, 0)


def _source_key() -> tuple[Any, ...]:
    return (
        _mtime_size(SHIPPED_JSON),
        _mtime_size(MILESTONES_JS),
        _mtime_size(UPDATES_INDEX),
        _mtime_size(SHORTCUTS_JSON),
        _mtime_size(CANVAS_JS),
        _mtime_size(SKETCH_JS),
        _mtime_size(_site_pages_path()),
    )


def _read_json(path: Path) -> Any:
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _clip(value: Any, limit: int) -> str:
    return str(value or "").replace("\r\n", "\n").strip()[:limit]


def _compact_update(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(row, dict):
        return None
    uid = _clip(row.get("id"), 80)
    title = _clip(row.get("title"), 200)
    if not uid or not title:
        return None
    keywords = row.get("keywords") if isinstance(row.get("keywords"), list) else []
    return {
        "id": uid,
        "date": _clip(row.get("date"), 32),
        "kind": _clip(row.get("kind") or "feature", 24) or "feature",
        "title": title,
        "summary": _clip(row.get("summary"), 280),
        "href": _clip(row.get("href") or "/updates.html", 400) or "/updates.html",
        "keywords": [_clip(k, 40) for k in keywords[:16] if str(k).strip()],
    }


def _parse_milestones_js(text: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for block in _MILESTONE_SPLIT.split(text):
        idm = re.search(r'id:\s*"([^"]+)"', block)
        if not idm:
            continue
        title = re.search(r'title:\s*"([^"]+)"', block)
        summary = re.search(r'summary:\s*\n?\s*"([^"]+)"', block)
        kind = re.search(r'kind:\s*"([^"]+)"', block)
        dt = re.search(r'date:\s*"([^"]+)"', block)
        href = re.search(r'href:\s*"([^"]+)"', block)
        keywords = []
        km = re.search(r"keywords:\s*(\[[^\]]*\])", block)
        if km:
            try:
                parsed = json.loads(km.group(1))
                if isinstance(parsed, list):
                    keywords = [str(k) for k in parsed if str(k).strip()]
            except Exception:
                keywords = []
        compact = _compact_update(
            {
                "id": idm.group(1),
                "title": title.group(1) if title else "",
                "summary": summary.group(1) if summary else "",
                "kind": kind.group(1) if kind else "feature",
                "date": dt.group(1) if dt else "",
                "href": href.group(1) if href else "/updates.html",
                "keywords": keywords,
            }
        )
        if compact:
            rows.append(compact)
    return rows


def _parse_js_string_map(blob: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for key, value in re.findall(r'([A-Za-z0-9_]+)\s*:\s*"([^"]+)"', blob or ""):
        out[key] = value
    return out


def _extract_named_js_maps(path: Path) -> dict[str, dict[str, str]]:
    if not path.is_file():
        return {}
    try:
        text = path.read_text(encoding="utf-8")
    except Exception:
        return {}
    found: dict[str, dict[str, str]] = {}
    for name, body in _JS_MAP_RE.findall(text):
        found[name] = _parse_js_string_map(body)
    return found


def _load_shortcut_contexts() -> list[dict[str, Any]]:
    data = _read_json(SHORTCUTS_JSON)
    contexts: list[dict[str, Any]] = []
    if isinstance(data, dict) and isinstance(data.get("contexts"), list):
        for ctx in data["contexts"]:
            if not isinstance(ctx, dict) or not ctx.get("id"):
                continue
            keys = []
            for row in ctx.get("keys") or []:
                if not isinstance(row, dict) or not row.get("combo") or not row.get("action"):
                    continue
                keys.append(
                    {
                        "combo": _clip(row.get("combo"), 40),
                        "action": _clip(row.get("action"), 160),
                        "keywords": [
                            _clip(k, 40)
                            for k in (row.get("keywords") or [])[:12]
                            if str(k).strip()
                        ],
                    }
                )
            contexts.append(
                {
                    "id": _clip(ctx.get("id"), 40),
                    "title": _clip(ctx.get("title"), 80),
                    "when": _clip(ctx.get("when"), 200),
                    "keys": keys,
                }
            )
    canvas_maps = _extract_named_js_maps(CANVAS_JS)
    sketch_maps = _extract_named_js_maps(SKETCH_JS)
    by_id = {ctx["id"]: ctx for ctx in contexts}
    canvas_letters = canvas_maps.get("shortcuts") or {}
    if canvas_letters:
        ctx = by_id.get("canvas")
        if not ctx:
            ctx = {"id": "canvas", "title": "Canvas tab", "when": "", "keys": []}
            contexts.append(ctx)
            by_id["canvas"] = ctx
        _overlay_letter_keys(ctx, canvas_letters, shift=False)
    sketch_letters = sketch_maps.get("SKETCH_SHORTCUTS") or {}
    if sketch_letters:
        ctx = by_id.get("sketch")
        if not ctx:
            ctx = {"id": "sketch", "title": "Constrained Sketch", "when": "", "keys": []}
            contexts.append(ctx)
            by_id["sketch"] = ctx
        _overlay_letter_keys(ctx, sketch_letters, shift=False)
    shift_sketch = sketch_maps.get("SHIFT_SKETCH_SHORTCUTS") or {}
    if shift_sketch and by_id.get("sketch"):
        _overlay_letter_keys(by_id["sketch"], shift_sketch, shift=True)
    return contexts


def _overlay_letter_keys(ctx: dict[str, Any], letter_map: dict[str, str], *, shift: bool) -> None:
    if not letter_map:
        return
    existing = list(ctx.get("keys") or [])
    by_combo = {str(row.get("combo") or "").lower(): row for row in existing}
    for letter, action in letter_map.items():
        combo = f"Shift+{letter.upper()}" if shift else letter.upper()
        label = str(action).replace("_", " ").replace("-", " ")
        prev = by_combo.get(combo.lower()) or {}
        keywords = list(prev.get("keywords") or [])
        if label not in keywords:
            keywords.append(label)
        by_combo[combo.lower()] = {
            "combo": combo,
            "action": _clip(prev.get("action") or label, 160),
            "keywords": [_clip(k, 40) for k in keywords[:12]],
        }
    ctx["keys"] = list(by_combo.values())


def write_updates_index(rows: list[dict[str, Any]] | None = None) -> Path:
    """Compact artifact for the agent; called from scan-milestones (hourly)."""
    items = []
    for row in rows or []:
        compact = _compact_update(row)
        if compact:
            items.append(compact)
    items.sort(key=lambda r: (str(r.get("date") or ""), str(r.get("id") or "")), reverse=True)
    UPDATES_INDEX.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "source": "scan-milestones",
        "href": "https://render3d.app/updates.html",
        "items": items[:MAX_UPDATES],
    }
    UPDATES_INDEX.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return UPDATES_INDEX


def _load_updates() -> list[dict[str, Any]]:
    by_id: dict[str, dict[str, Any]] = {}

    def _add(row: dict[str, Any] | None, *, prefer_existing: bool = False) -> None:
        compact = _compact_update(row)
        if not compact:
            return
        uid = compact["id"]
        if uid in by_id and prefer_existing:
            for key in ("keywords", "summary", "href", "date", "kind"):
                if not by_id[uid].get(key) and compact.get(key):
                    by_id[uid][key] = compact[key]
            if compact.get("keywords"):
                merged = list(by_id[uid].get("keywords") or [])
                for kw in compact["keywords"]:
                    if kw not in merged:
                        merged.append(kw)
                by_id[uid]["keywords"] = merged[:16]
            return
        if uid in by_id and not prefer_existing:
            compact["keywords"] = list(dict.fromkeys((by_id[uid].get("keywords") or []) + compact["keywords"]))[:16]
            if not compact.get("summary"):
                compact["summary"] = by_id[uid].get("summary") or ""
        by_id[uid] = compact

    index = _read_json(UPDATES_INDEX)
    index_mtime, _ = _mtime_size(UPDATES_INDEX)
    miles_mtime, _ = _mtime_size(MILESTONES_JS)
    use_index = isinstance(index, dict) and isinstance(index.get("items"), list) and index_mtime >= miles_mtime
    if use_index:
        for row in index.get("items") or []:
            _add(row if isinstance(row, dict) else None)
    elif MILESTONES_JS.is_file():
        try:
            for row in _parse_milestones_js(MILESTONES_JS.read_text(encoding="utf-8")):
                _add(row)
        except Exception:
            pass

    shipped = _read_json(SHIPPED_JSON)
    if isinstance(shipped, dict):
        for row in shipped.get("items") or []:
            _add(row if isinstance(row, dict) else None, prefer_existing=True)

    try:
        from backend.services import site_pages_service

        pages = site_pages_service.load()
        posts = (pages.get("updates") or {}).get("posts") or []
        builtins = list(by_id.values())
        overrides = {p.get("id"): p for p in posts if isinstance(p, dict) and p.get("id")}
        merged: list[dict[str, Any]] = []
        seen: set[str] = set()
        for item in builtins:
            extra = overrides.get(item["id"])
            if extra:
                compact = _compact_update({**item, **{k: extra.get(k) for k in ("title", "summary", "href", "date", "kind", "keywords") if extra.get(k) is not None}})
                if compact and extra.get("published") is False:
                    continue
                if compact:
                    merged.append(compact)
                    seen.add(compact["id"])
            else:
                merged.append(item)
                seen.add(item["id"])
        for post in posts:
            if not isinstance(post, dict) or not post.get("id") or post["id"] in seen:
                continue
            if post.get("published") is False:
                continue
            compact = _compact_update(post)
            if compact:
                merged.append(compact)
        merged.sort(key=lambda r: (str(r.get("date") or ""), str(r.get("id") or "")), reverse=True)
        return merged[:MAX_UPDATES]
    except Exception:
        rows = list(by_id.values())
        rows.sort(key=lambda r: (str(r.get("date") or ""), str(r.get("id") or "")), reverse=True)
        return rows[:MAX_UPDATES]


def clear_cache() -> None:
    _cache["key"] = None
    _cache["at"] = 0.0
    _cache["payload"] = None


def load_index() -> dict[str, Any]:
    key = _source_key()
    now = time.monotonic()
    if _cache["payload"] is not None and _cache["key"] == key and (now - float(_cache["at"] or 0)) < TTL_SEC:
        return _cache["payload"]
    shortcuts_doc = _read_json(SHORTCUTS_JSON)
    note = ""
    if isinstance(shortcuts_doc, dict):
        note = _clip(shortcuts_doc.get("note"), 400)
    payload = {
        "updates_href": "https://render3d.app/updates.html",
        "updates": _load_updates(),
        "shortcuts_note": note,
        "shortcuts": _load_shortcut_contexts(),
    }
    _cache["key"] = key
    _cache["at"] = now
    _cache["payload"] = payload
    return payload


_STOP = frozenset(
    {
        "the",
        "for",
        "and",
        "with",
        "from",
        "this",
        "that",
        "what",
        "whats",
        "what's",
        "which",
        "how",
        "does",
        "are",
        "in",
        "on",
        "to",
        "of",
        "a",
        "an",
        "is",
        "it",
        "or",
        "not",
        "do",
        "i",
        "you",
        "me",
        "please",
        "can",
        "be",
        "my",
        "shortcut",
        "shortcuts",
        "hotkey",
        "hotkeys",
        "keybind",
        "keybinds",
        "keyboard",
        "key",
        "keys",
        "press",
        "pressing",
        "accelerator",
        "studio",
        "render",
    }
)
_WORD_RE = re.compile(r"[a-z0-9+#.+-]+(?:'[a-z]+)?")


def _tokens(text: str, *, keep_letters: bool = False) -> set[str]:
    found = _WORD_RE.findall((text or "").lower())
    out: set[str] = set()
    for tok in found:
        if tok in _STOP:
            continue
        if len(tok) >= 3:
            out.add(tok)
        elif keep_letters and len(tok) == 1:
            out.add(tok)
    return out


def _looks_like_update_question(text: str) -> bool:
    return bool(WHAT_NEW_RE.search(text or ""))


def _looks_like_shortcut_question(text: str) -> bool:
    if SHORTCUT_INTENT_RE.search(text or ""):
        return True
    return bool(re.search(r"\b(what does|what is)\s+(the\s+)?([a-z]|esc|space|tab|delete|cmd\+z)\b", text or "", re.I))


def _score_blob(blob: str, tokens: set[str]) -> float:
    score = 0.0
    for tok in tokens:
        if len(tok) < 2:
            continue
        if tok in blob:
            score += 2.0 if " " not in tok and len(tok) < 5 else 3.0
    return score


def _match_updates(updates: list[dict[str, Any]], question: str) -> list[dict[str, Any]]:
    tokens = _tokens(question)
    if not tokens:
        return []
    scored: list[tuple[float, dict[str, Any]]] = []
    for item in updates:
        blob = " ".join(
            [
                str(item.get("id") or ""),
                str(item.get("title") or ""),
                str(item.get("summary") or ""),
                " ".join(item.get("keywords") or []),
            ]
        ).lower()
        score = _score_blob(blob, tokens)
        if score >= 3.0:
            scored.append((score, item))
    scored.sort(key=lambda row: -row[0])
    return [item for _, item in scored[:MAX_MATCHED_UPDATES]]


def _match_shortcut_contexts(contexts: list[dict[str, Any]], question: str) -> list[dict[str, Any]]:
    raw = (question or "").lower()
    tokens = _tokens(question, keep_letters=_looks_like_shortcut_question(question))
    dump_all = _looks_like_shortcut_question(question) and (
        re.search(r"\ball\b|\blist\b|\bkeyboard\b", raw)
        or raw.strip() in {"shortcuts", "shortcut", "hotkeys"}
    )
    if dump_all:
        return contexts
    matched: list[dict[str, Any]] = []
    for ctx in contexts:
        keys = []
        ctx_blob = " ".join([str(ctx.get("id") or ""), str(ctx.get("title") or "")]).lower()
        for row in ctx.get("keys") or []:
            combo = str(row.get("combo") or "")
            blob = " ".join(
                [combo, str(row.get("action") or ""), " ".join(row.get("keywords") or []), ctx_blob]
            ).lower()
            score = _score_blob(blob, tokens)
            combo_l = combo.lower().replace(" ", "")
            if len(combo_l) >= 2 and combo_l in raw.replace(" ", ""):
                score += 6.0
            letter = combo.lower()
            words = _WORD_RE.findall(raw)
            if len(letter) == 1 and letter in words:
                score += 4.0
            if score >= 3.0:
                keys.append(row)
        if keys:
            matched.append({**ctx, "keys": keys})
    if not matched and _looks_like_shortcut_question(question):
        return contexts
    return matched


def context_block(question: str) -> str:
    """Compact JSON for the model. Empty string when the question is unrelated."""
    text = (question or "").strip()
    if not text:
        return ""
    payload = load_index()
    want_new = _looks_like_update_question(text)
    want_keys = _looks_like_shortcut_question(text)
    updates = list(payload.get("updates") or [])
    contexts = list(payload.get("shortcuts") or [])
    matched_updates = _match_updates(updates, text)
    picked_updates = updates[:MAX_WHAT_NEW] if want_new else matched_updates
    if want_keys and not want_new:
        qtoks = _tokens(text)
        picked_updates = [
            item
            for item in matched_updates
            if any(len(tok) >= 4 and tok in str(item.get("title") or "").lower() for tok in qtoks)
        ]
    need_keys = want_keys or bool(HOW_RE.search(text)) or bool(matched_updates)
    picked_keys = _match_shortcut_contexts(contexts, text) if need_keys else []
    if not picked_updates and not picked_keys and not want_new and not want_keys:
        return ""
    if want_new and not picked_updates:
        picked_updates = updates[:MAX_WHAT_NEW]
    body: dict[str, Any] = {
        "source": "https://render3d.app/updates.html + Studio keybindings",
        "instruction": (
            "Cite update dates and titles. Use these shortcuts; do not invent keys. "
            "Say which context (viewport vs Canvas vs Sketch vs clip editor) applies."
        ),
    }
    if picked_updates:
        body["updates"] = [
            {
                "date": item.get("date"),
                "title": item.get("title"),
                "summary": item.get("summary"),
                "href": item.get("href") or "/updates.html",
            }
            for item in picked_updates
        ]
    if picked_keys:
        if payload.get("shortcuts_note"):
            body["shortcuts_note"] = payload["shortcuts_note"]
        body["shortcuts"] = [
            {
                "context": ctx.get("title"),
                "when": ctx.get("when"),
                "keys": [{"combo": k.get("combo"), "action": k.get("action")} for k in (ctx.get("keys") or [])],
            }
            for ctx in picked_keys
        ]
    encoded = json.dumps(body, separators=(",", ":"), ensure_ascii=False)
    if len(encoded) > MAX_BLOCK_CHARS:
        encoded = encoded[: MAX_BLOCK_CHARS - 3] + "..."
    return "Live product index JSON:\n" + encoded
