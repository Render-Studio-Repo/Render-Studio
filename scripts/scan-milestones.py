#!/usr/bin/env python3
"""Auto-scan shipped user-facing features and sync Recent Updates milestones.

Sources (in order):
  1. frontend/docs/updates/shipped.json     — explicit registry (agents/CI append here)
  2. frontend/getting-started-guides.js    — Getting Started feature cards
  3. frontend/roadmap.html                 — items marked Done / shipped
  4. Code markers: /* @milestone id=... title="..." summary="..." */

Writes missing entries into frontend/docs/updates/milestones.js (newest first)
and bumps ?v= cache busts on updates.html / updates.js imports.

Usage:
  python scripts/scan-milestones.py           # apply
  python scripts/scan-milestones.py --dry-run # preview only
"""

from __future__ import annotations

import argparse
import sys
import json
import re
import subprocess
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MILESTONES = ROOT / "frontend" / "docs" / "updates" / "milestones.js"
SHIPPED = ROOT / "frontend" / "docs" / "updates" / "shipped.json"
GUIDES = ROOT / "frontend" / "getting-started-guides.js"
ROADMAP = ROOT / "frontend" / "roadmap.html"
UPDATES_HTML = ROOT / "frontend" / "updates.html"
UPDATES_JS = ROOT / "frontend" / "updates.js"

# Existing milestone ids that already cover a Getting Started / roadmap id.
COVERED_BY: dict[str, set[str]] = {
    "ai-generate": {"ai-cad-generate", "ai-generate"},
    "picks": {"geometry-picks", "picks"},
    "share-folders": {"share-private-folder", "share-folders"},
    "workspaces": {"live-folder-project-sync", "workspaces"},
    "reference-markup": {"reference-markup-send-ai", "reference-markup"},
    "canvas": {"canvas-sketch-mode", "canvas"},
    "wiring": {"wiring-simulator", "wiring"},
    "render-agent": {"getting-started-demos-agent", "render-agent"},
    "cloud-sync": {"cloud-sync"},
    "link-to-prompt": {"link-to-prompt"},
    "tips-library": {"tips-tricks", "tips-library"},
    "tips-tricks": {"tips-tricks", "tips-library"},
}

SKIP_IDS = {
    # Docs chrome / polish — not workflow milestones
    "preferences",
}


def js_str(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", " ") + '"'


def kebab(value: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "-", (value or "").strip().lower()).strip("-")
    return re.sub(r"-{2,}", "-", s) or "feature"


def today() -> str:
    return date.today().isoformat()


def cache_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")


def parse_milestones(text: str) -> list[dict]:
    rows: list[dict] = []
    for block in re.split(r"\n  \},\n", text):
        idm = re.search(r'id:\s*"([^"]+)"', block)
        if not idm:
            continue
        title = re.search(r'title:\s*"([^"]+)"', block)
        summary = re.search(r'summary:\s*\n?\s*"([^"]+)"', block)
        kind = re.search(r'kind:\s*"([^"]+)"', block)
        dt = re.search(r'date:\s*"([^"]+)"', block)
        visual = re.search(r'visual:\s*"([^"]+)"', block)
        href = re.search(r'href:\s*"([^"]+)"', block)
        rows.append(
            {
                "id": idm.group(1),
                "title": title.group(1) if title else idm.group(1),
                "summary": summary.group(1) if summary else "",
                "kind": kind.group(1) if kind else "feature",
                "date": dt.group(1) if dt else today(),
                "visual": visual.group(1) if visual else "",
                "href": href.group(1) if href else "",
            }
        )
    return rows


def existing_coverage(rows: list[dict]) -> set[str]:
    ids = {r["id"] for r in rows}
    titles = {r["title"].strip().lower() for r in rows}
    covered = set(ids)
    for src_id, aliases in COVERED_BY.items():
        if ids & aliases:
            covered.add(src_id)
            covered |= aliases
    for r in rows:
        covered.add(r["id"])
        # title match helper
        covered.add(kebab(r["title"]))
    return covered | titles


def is_covered(candidate_id: str, title: str, covered: set[str]) -> bool:
    cid = candidate_id.strip().lower()
    if cid in SKIP_IDS:
        return True
    if cid in covered:
        return True
    aliases = COVERED_BY.get(cid, set()) | {cid}
    if covered & aliases:
        return True
    if title.strip().lower() in covered:
        return True
    # soft title overlap
    t = title.strip().lower()
    for c in covered:
        if len(c) >= 12 and (c in t or t in c):
            return True
    return False


def load_shipped_registry() -> list[dict]:
    if not SHIPPED.is_file():
        return []
    try:
        data = json.loads(SHIPPED.read_text(encoding="utf-8"))
    except Exception:
        return []
    rows = data if isinstance(data, list) else data.get("items") or []
    out = []
    for row in rows:
        if not isinstance(row, dict) or not row.get("id") or not row.get("title"):
            continue
        out.append(
            {
                "id": kebab(str(row["id"])),
                "title": str(row["title"]).strip(),
                "summary": str(row.get("summary") or row["title"]).strip(),
                "kind": "tool" if str(row.get("kind") or "").lower() == "tool" else "feature",
                "date": str(row.get("date") or today()),
                "visual": str(row.get("visual") or ""),
                "href": str(row.get("href") or ""),
                "source": "shipped.json",
            }
        )
    return out


def load_getting_started() -> list[dict]:
    if not GUIDES.is_file():
        return []
    text = GUIDES.read_text(encoding="utf-8")
    match = re.search(r"export const GETTING_STARTED_GUIDES = \[(.*?)\n\];", text, re.S)
    if not match:
        return []
    body = match.group(1)
    out = []
    for block in re.split(r"\n  \},\n", body):
        idm = re.search(r'"id":\s*"([^"]+)"', block)
        cat = re.search(r'"category":\s*"([^"]+)"', block)
        title = re.search(r'"title":\s*"([^"]+)"', block)
        summary = re.search(r'"summary":\s*"([^"]+)"', block)
        gif = re.search(r'"gif":\s*"([^"]+)"', block)
        if not (idm and cat and title and summary):
            continue
        gid = idm.group(1)
        out.append(
            {
                "id": gid,
                "title": title.group(1),
                "summary": summary.group(1).strip(),
                "kind": "tool" if any(k in gid for k in ("tool", "simulator", "canvas", "wiring")) else "feature",
                "date": today(),
                "visual": gif.group(1) if gif else "",
                "href": f"/getting-started.html#{gid}",
                "source": "getting-started",
            }
        )
    return out


def load_roadmap_shipped() -> list[dict]:
    if not ROADMAP.is_file():
        return []
    text = ROADMAP.read_text(encoding="utf-8")
    out = []
    # Each shipped <li class="roadmap-item done"> … <h4>Title</h4><p>…</p>
    for m in re.finditer(
        r'<li class="roadmap-item done"[^>]*(?:data-roadmap-show="([^"]+)"|data-roadmap-doc="([^"]+)")?[^>]*>'
        r'(.*?)</li>',
        text,
        re.S,
    ):
        show_id, doc, body = m.groups()
        title_m = re.search(r"<h4>(.*?)</h4>", body, re.S)
        summary_m = re.search(r"<p>(.*?)</p>", body, re.S)
        if not title_m:
            continue
        title = re.sub(r"<[^>]+>", "", title_m.group(1)).strip()
        summary = re.sub(r"<[^>]+>", "", (summary_m.group(1) if summary_m else title)).strip()
        rid = show_id or kebab(title)
        href = f"/getting-started.html#{show_id}" if show_id else (doc or "/roadmap.html")
        out.append(
            {
                "id": rid,
                "title": title,
                "summary": summary,
                "kind": "feature",
                "date": today(),
                "visual": "",
                "href": href,
                "source": "roadmap",
            }
        )
    return out


def load_code_markers() -> list[dict]:
    """Scan frontend for /* @milestone ... */ annotations."""
    out = []
    pattern = re.compile(
        r"@milestone\s+id=([a-z0-9-]+)\s+title=\"([^\"]+)\"\s+summary=\"([^\"]+)\"(?:\s+kind=(feature|tool))?(?:\s+href=\"([^\"]*)\")?(?:\s+visual=\"([^\"]*)\")?",
        re.I,
    )
    for path in (ROOT / "frontend").rglob("*"):
        if path.suffix.lower() not in {".js", ".css", ".html", ".md"}:
            continue
        if "node_modules" in path.parts:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        for m in pattern.finditer(text):
            out.append(
                {
                    "id": m.group(1),
                    "title": m.group(2),
                    "summary": m.group(3),
                    "kind": m.group(4) or "feature",
                    "date": today(),
                    "href": m.group(5) or "",
                    "visual": m.group(6) or "",
                    "source": f"marker:{path.relative_to(ROOT)}",
                }
            )
    return out


def collect_candidates() -> list[dict]:
    # Prefer explicit registry, then guides, roadmap, markers.
    # Deduplicate by id keeping first (highest priority) occurrence.
    ordered = (
        load_shipped_registry()
        + load_getting_started()
        + load_roadmap_shipped()
        + load_code_markers()
    )
    seen: set[str] = set()
    out = []
    for row in ordered:
        cid = row["id"]
        if cid in seen or cid in SKIP_IDS:
            continue
        seen.add(cid)
        out.append(row)
    return out


def format_entry(row: dict) -> str:
    fields = [
        f'    id: {js_str(row["id"])},',
        f'    date: {js_str(row.get("date") or today())},',
        f'    kind: {js_str(row.get("kind") or "feature")},',
        f'    title: {js_str(row["title"])},',
        f'    summary:',
        f'      {js_str(row.get("summary") or row["title"])},',
    ]
    if row.get("visual"):
        fields.append(f'    visual: {js_str(row["visual"])},')
    if row.get("href"):
        fields.append(f'    href: {js_str(row["href"])},')
    return "  {\n" + "\n".join(fields) + "\n  },\n"


def insert_milestones(text: str, entries: list[dict]) -> str:
    if not entries:
        return text
    marker = "export const MILESTONE_UPDATES = [\n"
    if marker not in text:
        raise SystemExit("Could not find MILESTONE_UPDATES array")
    block = "".join(format_entry(e) for e in entries)
    return text.replace(marker, marker + block, 1)


def bump_cache() -> None:
    stamp = cache_stamp()
    if UPDATES_JS.is_file():
        js = UPDATES_JS.read_text(encoding="utf-8")
        js2 = re.sub(
            r'(milestones\.js\?v=)[^"\']+',
            rf"\g<1>{stamp}",
            js,
            count=1,
        )
        if js2 != js:
            UPDATES_JS.write_text(js2, encoding="utf-8")
    if UPDATES_HTML.is_file():
        html = UPDATES_HTML.read_text(encoding="utf-8")
        html2 = re.sub(
            r'(updates\.js\?v=)[^"\']+',
            rf"\g<1>{stamp}",
            html,
            count=1,
        )
        if html2 != html:
            UPDATES_HTML.write_text(html2, encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    text = MILESTONES.read_text(encoding="utf-8")
    existing = parse_milestones(text)
    covered = existing_coverage(existing)
    existing_ids = {r["id"] for r in existing}

    missing = []
    for cand in collect_candidates():
        if cand["id"] in existing_ids:
            continue
        if is_covered(cand["id"], cand["title"], covered):
            continue
        missing.append(cand)
        covered.add(cand["id"])
        covered.add(cand["title"].strip().lower())
        existing_ids.add(cand["id"])

    if not missing:
        if not args.quiet:
            print("Milestones up to date — nothing to add.")
        return

    if not args.quiet:
        print(f"Adding {len(missing)} milestone(s):")
        for row in missing:
            print(f"  + {row['id']} ({row.get('source')}) — {row['title']}")

    if args.dry_run:
        return

    MILESTONES.write_text(insert_milestones(text, missing), encoding="utf-8")
    bump_cache()
    if not args.quiet:
        print(f"Updated {MILESTONES.relative_to(ROOT)}")

    # Push new milestones to Discord (best-effort; never fail the scan).
    try:
        sys.path.insert(0, str(ROOT))
        from backend.services import discord_updates_service as discord

        if discord.configured():
            result = discord.announce_updates(missing)
            if not args.quiet:
                print(
                    f"Discord: posted={result.get('posted')} "
                    f"skipped={result.get('skipped')} failed={result.get('failed')}"
                )
                if result.get("failed"):
                    st = discord.connection_status()
                    if st.get("error"):
                        print(f"Discord note: {st['error']}")
                    if st.get("invite_url") and st.get("guild_count", 0) == 0:
                        print(f"Invite bot: {st['invite_url']}")
        elif not args.quiet:
            print("Discord: not configured — skipped announce")
    except Exception as err:
        if not args.quiet:
            print(f"Discord announce skipped: {err}")


if __name__ == "__main__":
    main()
