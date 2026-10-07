#!/usr/bin/env python3
"""Auto-scan shipped user-facing features and sync Recent Updates milestones.

Sources (in order):
  1. frontend/docs/updates/shipped.json     — explicit registry (agents/CI append here)
  2. ai-context/worklog.md                  — BIG product headings from the last 3 weeks
  3. frontend/site/getting-started-guides.js    — Getting Started feature cards
  4. frontend/pages/roadmap.html                 — items marked Done / shipped
  5. Code markers: /* @milestone id=... title="..." summary="..." */

Writes missing entries into frontend/docs/updates/milestones.js (newest first)
and bumps ?v= cache busts on updates.html / updates.js imports.

Hourly LaunchAgent: deploy/mac/com.render3d.scan-milestones.plist
Admin “Add update” already publishes via /api/admin/site-pages (no HTML edit).

Usage:
  python scripts/scan-milestones.py           # apply
  python scripts/scan-milestones.py --dry-run # preview only
  python scripts/scan-milestones.py --skip-social  # no Discord/LinkedIn
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MILESTONES = ROOT / "frontend" / "docs" / "updates" / "milestones.js"
SHIPPED = ROOT / "frontend" / "docs" / "updates" / "shipped.json"
WORKLOG = ROOT / "ai-context" / "worklog.md"
GUIDES = ROOT / "frontend" / "site" / "getting-started-guides.js"
ROADMAP = ROOT / "frontend" / "pages" / "roadmap.html"
UPDATES_HTML = ROOT / "frontend" / "pages" / "updates.html"
UPDATES_JS = ROOT / "frontend" / "site" / "updates.js"
SCAN_LOG = ROOT / "logs" / "scan-milestones.log"
WORKLOG_LOOKBACK_DAYS = 21

# Worklog auto-ingest is opt-in: `@milestone` in the heading, or a title that
# is itself a product-launch phrase. Body mentions of FreeCAD/McMaster
# (bugfixes) must not spam Recent Updates.
WORKLOG_TITLE_RE = re.compile(
    r"imagine panel|parts catalog|clip editor|video editor|"
    r"viser lan|control center|prompt persist|faster boot|"
    r"reference files folder|freecad is the source|dimos stays gated|"
    r"insert tab|viewport split|native joints|code workspace|"
    r"public pin|film.?edit|settings search|mobile studio|"
    r"share.?remix|wrist cam|public room|document tab|"
    r"kernel measure|spatial AI draw|send to wiring|"
    r"edit selected|database config|exploded view",
    re.I,
)
WORKLOG_SKIP_RE = re.compile(
    r"\b(lag|fps|crash|polish|logo|sheen|favicon|hitch|cache-bust|"
    r"snap on chip|stray|viewport missing|wordmark)\b",
    re.I,
)

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
    "admin-control-center": {"admin-control-center", "management-control-center", "cc1"},
    "management-control-center": {"admin-control-center", "management-control-center"},
    "imagine-panel": {"imagine-panel", "imagine1", "imagine-fetch"},
    "parts-catalog-mcmaster": {"parts-catalog-mcmaster", "parts-catalog", "insert-tab"},
    "freecad-kernel-edit": {"freecad-kernel-edit", "fc-extrude", "fcdoc1", "freecad-kernel"},
    "freecad-kernel": {"freecad-kernel-edit", "freecad-kernel"},
    "wrist-cameras": {"wrist-cameras", "robotics-wrist-cameras"},
    "robotics-wrist-cameras": {"wrist-cameras", "robotics-wrist-cameras"},
    "share-remix": {"share-remix", "public-share"},
    "vr-spatial-draw": {"vr-spatial-draw", "vr-ai-draw"},
    "database-setup": {"database-setup", "self-host"},
    "prompt-persist-faster-boot": {"prompt-persist-faster-boot", "prompt-persist"},
    "prompt-persist": {"prompt-persist-faster-boot", "prompt-persist"},
    "reference-folders-captures": {"reference-folders-captures", "reference-folders"},
    "reference-folders": {"reference-folders-captures", "reference-folders"},
    "wiring-compose": {"wiring-compose", "wiring"},
    "document-tabs": {"document-tabs", "viewport-document-tab-strip"},
    "public-room": {"public-room", "public-room-drop-a-project-both-people-can-pick-up"},
    "edit-selected": {
        "edit-selected",
        "mcmaster-crawls-fail-fast-edit-selected-stays-in-vibecad",
        "collapse-bodies-in-edit-selected-picker",
    },
    "wrist-cameras": {"wrist-cameras", "robotics-wrist-cameras", "wrist-camera-dragging-and-minimize"},
    "database-setup": {"database-setup", "self-host", "docs-hero-spacing-database-configuration-tab"},
    "plus-new-project": {"plus-new-project", "projects-upload"},
}

SKIP_IDS = {
    # Docs chrome / polish — not workflow milestones
    "preferences",
    "projects-upload",
    "credibility",
    "send-to-slicer",
    "restore-updates-tab-two-week-milestones",
    "docs-hero-spacing-database-configuration-tab",
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
    for src_id, src_aliases in COVERED_BY.items():
        if cid in src_aliases and (src_id in covered or covered & src_aliases):
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
        if not isinstance(row, dict) or not row.get("id"):
            continue
        keywords = row.get("keywords") or []
        if not isinstance(keywords, list):
            keywords = []
        title = str(row.get("title") or "").strip() or str(row["id"]).replace("-", " ")
        out.append(
            {
                "id": kebab(str(row["id"])),
                "title": title,
                "summary": str(row.get("summary") or title).strip(),
                "kind": "tool" if str(row.get("kind") or "").lower() == "tool" else "feature",
                "date": str(row.get("date") or today()),
                "visual": str(row.get("visual") or ""),
                "href": str(row.get("href") or ""),
                "keywords": [str(k) for k in keywords if str(k).strip()],
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


def _first_worklog_bullet(block: str) -> str:
    for line in block.splitlines():
        stripped = line.strip()
        if stripped.startswith("- "):
            return re.sub(r"^[-*]\s+", "", stripped).strip()
    return ""


def load_worklog(since: str | None = None) -> list[dict]:
    """BIG worklog headings from the last N days, plus any `@milestone` titles."""
    if not WORKLOG.is_file():
        return []
    text = WORKLOG.read_text(encoding="utf-8")
    cutoff = since or (date.fromisoformat(today()) - timedelta(days=WORKLOG_LOOKBACK_DAYS)).isoformat()
    heading = re.compile(r"^## (\d{4}-\d{2}-\d{2}) — (.+)$", re.M)
    matches = list(heading.finditer(text))
    out = []
    for i, m in enumerate(matches):
        dt, title = m.group(1), m.group(2).strip()
        if dt < cutoff and "@milestone" not in title.lower():
            continue
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[m.end() : end]
        tagged = "@milestone" in title.lower() or "@milestone" in body[:1200].lower()
        if not tagged and WORKLOG_SKIP_RE.search(title):
            continue
        if not tagged and not WORKLOG_TITLE_RE.search(title):
            continue
        clean_title = re.sub(r"\s*\(@milestone[^)]*\)\s*", "", title, flags=re.I).strip()
        clean_title = re.sub(r"`[^`]+`", "", clean_title)
        clean_title = re.sub(r"\s*\([^)]*\)\s*$", "", clean_title).strip(" —-")
        summary = _first_worklog_bullet(body) or clean_title
        summary = re.sub(r"\s+", " ", summary)[:280]
        out.append(
            {
                "id": kebab(clean_title)[:80],
                "title": clean_title[:120],
                "summary": summary,
                "kind": "tool" if re.search(r"\b(tool|editor|catalog|panel)\b", clean_title, re.I) else "feature",
                "date": dt,
                "visual": "",
                "href": "/updates.html",
                "source": "worklog",
            }
        )
    return out


def collect_candidates(since: str | None = None) -> list[dict]:
    # Prefer explicit registry, then recent worklog, then guides, roadmap, markers.
    # Deduplicate by id keeping first (highest priority) occurrence.
    ordered = (
        load_shipped_registry()
        + load_worklog(since)
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
    keywords = row.get("keywords") or []
    if isinstance(keywords, list) and keywords:
        fields.append(f'    keywords: {json.dumps([str(k) for k in keywords])},')
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
        js2 = re.sub(
            r'(shipped\.json\?v=)[^"\']+',
            rf"\g<1>{stamp}",
            js2,
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


def heartbeat(msg: str) -> None:
    try:
        SCAN_LOG.parent.mkdir(parents=True, exist_ok=True)
        with SCAN_LOG.open("a", encoding="utf-8") as fh:
            fh.write(f"{datetime.now(timezone.utc).isoformat()} {msg}\n")
    except Exception:
        pass


def upsert_shipped(rows: list[dict]) -> None:
    """Keep shipped.json in sync so /updates.html can fetch it without a CMS pass."""
    data: dict = {"items": []}
    if SHIPPED.is_file():
        try:
            raw = json.loads(SHIPPED.read_text(encoding="utf-8"))
        except Exception:
            raw = {"items": []}
        data = raw if isinstance(raw, dict) else {"items": list(raw or [])}
        data.setdefault("items", [])
    by_id = {str(x.get("id")): x for x in data["items"] if isinstance(x, dict) and x.get("id")}
    for row in rows:
        cid = str(row.get("id") or "")
        if not cid:
            continue
        payload = {
            "id": cid,
            "date": row.get("date") or today(),
            "kind": row.get("kind") or "feature",
            "title": row.get("title") or cid.replace("-", " "),
            "summary": row.get("summary") or row.get("title") or cid,
            "href": row.get("href") or "/updates.html",
        }
        if row.get("visual"):
            payload["visual"] = row["visual"]
        if row.get("keywords"):
            payload["keywords"] = row["keywords"]
        existing = by_id.get(cid)
        if existing:
            if not existing.get("title"):
                existing["title"] = payload["title"]
            if not existing.get("summary"):
                existing["summary"] = payload["summary"]
            if payload.get("visual") and not existing.get("visual"):
                existing["visual"] = payload["visual"]
            continue
        data["items"].insert(0, payload)
        by_id[cid] = payload
    SHIPPED.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def _write_agent_updates_index(rows: list[dict]) -> None:
    """Tiny JSON for Render Agent — not a full-text indexer."""
    try:
        if str(ROOT) not in sys.path:
            sys.path.insert(0, str(ROOT))
        from backend.services.render_agent_live_index import write_updates_index

        write_updates_index(rows)
    except Exception as err:
        print(f"agent updates index skipped: {err}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--quiet", action="store_true")
    ap.add_argument("--skip-social", action="store_true", help="Do not announce to Discord/LinkedIn")
    ap.add_argument("--since", default="", help="Worklog ISO date cutoff (default: 21 days ago)")
    args = ap.parse_args()

    text = MILESTONES.read_text(encoding="utf-8")
    existing = parse_milestones(text)
    covered = existing_coverage(existing)
    existing_ids = {r["id"] for r in existing}
    heartbeat("scan start")

    missing = []
    for cand in collect_candidates(args.since or None):
        if cand["id"] in existing_ids:
            continue
        if is_covered(cand["id"], cand["title"], covered):
            continue
        missing.append(cand)
        covered.add(cand["id"])
        covered.add(cand["title"].strip().lower())
        covered |= COVERED_BY.get(cand["id"], set())
        existing_ids.add(cand["id"])

    if not missing:
        if not args.dry_run:
            upsert_shipped(existing)
            _write_agent_updates_index(existing)
        heartbeat("up to date")
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
    upsert_shipped(missing + existing)
    bump_cache()
    _write_agent_updates_index(missing + existing)
    heartbeat(f"added {len(missing)}")
    if not args.quiet:
        print(f"Updated {MILESTONES.relative_to(ROOT)}")

    # Push new milestones to Discord + LinkedIn (best-effort; never fail the scan).
    if args.skip_social:
        return
    try:
        sys.path.insert(0, str(ROOT))
        from backend.services import social_updates_service as social

        cfg = social.configured()
        if cfg.get("any"):
            result = social.announce_updates(missing)
            if not args.quiet:
                print(f"Social announce: {json.dumps({k: v for k, v in result.items() if k != 'results'})}")
                for row in result.get("results") or []:
                    disc = row.get("discord") or {}
                    li = row.get("linkedin") or {}
                    if disc.get("error") or (disc.get("ok") is False and not disc.get("skipped")):
                        print(f"  Discord fail: {disc.get('error') or disc}")
                    if li.get("error") or (li.get("ok") is False and not li.get("skipped")):
                        print(f"  LinkedIn fail: {li.get('error') or li}")
                st = social.connection_status()
                disc = st.get("discord") or {}
                if disc.get("invite_url") and not disc.get("channel_ok"):
                    print(f"Invite Discord bot: {disc['invite_url']}")
        elif not args.quiet:
            print("Social: not configured — skipped Discord/LinkedIn announce")
    except Exception as err:
        if not args.quiet:
            print(f"Social announce skipped: {err}")

if __name__ == "__main__":
    main()
