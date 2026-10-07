#!/usr/bin/env python3
"""Finish open-source frontend reorg: keep dest copies, drop root duplicates, rewrite if needed."""
from __future__ import annotations

import json
import os
import re
import shutil
from pathlib import Path

ROOT = Path("/Users/sam/Render-Studio")
FRONTEND = ROOT / "frontend"
MAP_PATH = FRONTEND / "path-map.json"
CACHE = "20260908-layout"

SKIP_ROOT = {"index.html", "path-map.json"}

IMPORT_RE = re.compile(
    r"""(?P<prefix>(?:from|import)\s*\(?\s*)(?P<q>['"])(?P<path>\./[^'"]+)(?P=q)"""
)
JOIN_HERE_RE = re.compile(r"""join\(\s*here\s*,\s*(['"])([^'"]+)\1\s*\)""")
ABS_ASSET_RE = re.compile(
    r"""(?P<pre>(?:src|href)=)(?P<q>['"])/(?P<name>[A-Za-z0-9._-]+\.(?:js|css|png|svg|ico|jpg|jpeg))(?P<qs>\?[^'"]*)?(?P=q)"""
)
ABS_URL_RE = re.compile(
    r"""(?P<pre>url\(\s*)(?P<q>['"]?)/(?P<name>[A-Za-z0-9._-]+\.(?:png|svg|ico|jpg|jpeg|css))(?P<qs>\?[^)'"]*)?(?P<q2>['"]?)\s*\)"""
)


def load_map() -> dict[str, str]:
    return json.loads(MAP_PATH.read_text(encoding="utf-8"))


def rel_between(from_file: Path, to_rel: str) -> str:
    target = FRONTEND / to_rel
    start = from_file.parent
    s = os.path.relpath(target, start).replace("\\", "/")
    if not s.startswith("."):
        s = "./" + s
    return s


def rewrite_text(text: str, current: Path, mapping: dict[str, str], *, html_pages_keep_urls: bool) -> str:
    def spec_to_new(spec: str) -> str:
        path, q, *rest = spec.partition("?")
        name = Path(path).name
        if name not in mapping:
            return spec
        dest = mapping[name]
        new_rel = rel_between(current, dest)
        return new_rel + (q if q else "") + "".join(rest)

    def sub_import(m: re.Match) -> str:
        return f"{m.group('prefix')}{m.group('q')}{spec_to_new(m.group('path'))}{m.group('q')}"

    text = IMPORT_RE.sub(sub_import, text)

    def sub_join(m: re.Match) -> str:
        q, name = m.group(1), m.group(2)
        if name not in mapping:
            return m.group(0)
        dest = mapping[name]
        new_rel = rel_between(current, dest)
        if new_rel.startswith("./"):
            new_rel = new_rel[2:]
        return f"join(here, {q}{new_rel}{q})"

    text = JOIN_HERE_RE.sub(sub_join, text)

    def sub_abs(m: re.Match) -> str:
        name = m.group("name")
        if name.endswith(".html") and html_pages_keep_urls:
            return m.group(0)
        if name not in mapping:
            return m.group(0)
        dest = mapping[name]
        qs = m.group("qs") or ""
        if qs:
            qs = re.sub(r"v=[^&'\"#]+", f"v={CACHE}", qs)
        else:
            qs = f"?v={CACHE}"
        return f"{m.group('pre')}{m.group('q')}/{dest}{qs}{m.group('q')}"

    if current.suffix in {".html", ".js", ".css", ".mjs"}:
        text = ABS_ASSET_RE.sub(sub_abs, text)

        def sub_quoted_root(m: re.Match) -> str:
            q, name, qs = m.group(1), m.group(2), m.group(3) or ""
            if name not in mapping:
                return m.group(0)
            dest = mapping[name]
            if qs:
                qs = re.sub(r"v=[^&'\"#]+", f"v={CACHE}", qs)
            return f"{q}/{dest}{qs}{q}"

        text = re.sub(
            r"""(['"])/([A-Za-z0-9._-]+\.(?:png|svg|ico|jpg|jpeg|css|js))(\?[^'"]*)?(\1)""",
            lambda m: sub_quoted_root(m) if m.group(2) in mapping else m.group(0),
            text,
        )

    return text


def sync_and_drop_root(mapping: dict[str, str]) -> tuple[int, int, int]:
    moved, overwritten, deleted = 0, 0, 0
    for name, dest_rel in mapping.items():
        src = FRONTEND / name
        dst = FRONTEND / dest_rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        if src.exists() and src.is_file():
            if not dst.exists():
                shutil.move(str(src), str(dst))
                moved += 1
                body = dst.read_bytes()
                if dest_rel.endswith((".js", ".css", ".html", ".mjs")):
                    try:
                        text = body.decode("utf-8")
                    except UnicodeDecodeError:
                        text = None
                    if text is not None:
                        new = rewrite_text(text, dst, mapping, html_pages_keep_urls=True)
                        if new != text:
                            dst.write_text(new, encoding="utf-8")
            else:
                if src.stat().st_mtime > dst.stat().st_mtime + 0.5:
                    # Root is newer (in-flight edit). Keep latest bytes, then rewrite refs.
                    raw = src.read_bytes()
                    dst.write_bytes(raw)
                    overwritten += 1
                    if dest_rel.endswith((".js", ".css", ".html", ".mjs")):
                        try:
                            text = raw.decode("utf-8")
                        except UnicodeDecodeError:
                            text = None
                        if text is not None:
                            new = rewrite_text(text, dst, mapping, html_pages_keep_urls=True)
                            dst.write_text(new, encoding="utf-8")
                src.unlink()
                deleted += 1
        elif not dst.exists():
            print(f"MISSING both: {name} -> {dest_rel}")
    return moved, overwritten, deleted


def move_leftovers(mapping: dict[str, str]) -> list[str]:
    notes = []
    jpg = FRONTEND / "render3d-logo.jpg"
    if jpg.exists():
        dest = FRONTEND / "assets" / "brand" / "render3d-logo.jpg"
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists():
            jpg.unlink()
        else:
            shutil.move(str(jpg), str(dest))
        notes.append("render3d-logo.jpg -> assets/brand/")
        mapping["render3d-logo.jpg"] = "assets/brand/render3d-logo.jpg"
    logo_dir = FRONTEND / "logo"
    if logo_dir.is_dir():
        for p in logo_dir.iterdir():
            if p.is_file():
                dest = FRONTEND / "assets" / "brand" / p.name
                if not dest.exists():
                    shutil.move(str(p), str(dest))
                    notes.append(f"logo/{p.name} -> assets/brand/")
                else:
                    p.unlink()
        try:
            logo_dir.rmdir()
        except OSError:
            pass
    return notes


def rewrite_all_dest(mapping: dict[str, str]) -> int:
    changed = 0
    for dest_rel in mapping.values():
        path = FRONTEND / dest_rel
        if not path.exists() or path.suffix not in {".js", ".css", ".html", ".mjs"}:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        new = rewrite_text(text, path, mapping, html_pages_keep_urls=True)
        if new != text:
            path.write_text(new, encoding="utf-8")
            changed += 1
    # index.html stays at root
    index = FRONTEND / "index.html"
    text = index.read_text(encoding="utf-8")
    new = rewrite_text(text, index, mapping, html_pages_keep_urls=True)
    # bump cache on already-rewritten /studio/ etc. query strings for entry assets
    def bump_entry(m: re.Match) -> str:
        return f"{m.group(1)}={m.group(2)}{m.group(3)}{m.group(4)}{CACHE}{m.group(2)}"

    new2 = re.sub(
        r"(src|href)=([\"'])(/(?:studio|boot|components|cad|marketplace|site|admin|xr|viewport|workspace|social|architect|scripting|wiring|pages|assets)/[^\"']+\.(?:js|css))(\?v=)[^\"']+(\2)",
        bump_entry,
        new,
    )
    if new2 != text:
        index.write_text(new2, encoding="utf-8")
        changed += 1
    return changed


def dump_aliases(mapping: dict[str, str]) -> None:
    # Do not expose archive bak files at old URLs.
    aliases = {k: v for k, v in mapping.items() if "_archive/" not in v and ".bak" not in k}
    body = ['"""Legacy frontend URL aliases after the 2026-09-08 folder reorg."""', "", "from __future__ import annotations", "", "ALIASES: dict[str, str] = {"]
    for k in sorted(aliases):
        body.append(f'    "{k}": "{aliases[k]}",')
    body.append("}")
    body.append("")
    body.append("")
    body.append("def resolve_frontend_rel(full_path: str) -> str:")
    body.append('    raw = str(full_path or "").lstrip("/")')
    body.append("    if raw.startswith(\"_archive/\") or \"/_archive/\" in raw or \".bak\" in Path(raw).name:")
    body.append('        return raw  # caller should 404 archive/bak')
    body.append("    if raw in ALIASES:")
    body.append("        return ALIASES[raw]")
    body.append("    name = raw.split(\"/\")[-1]")
    body.append('    if name in ALIASES and "/" not in raw:')
    body.append("        return ALIASES[name]")
    body.append("    return raw")
    body.append("")
    # Need Path import
    text = "\n".join(body).replace(
        "from __future__ import annotations\n\nALIASES",
        "from __future__ import annotations\n\nfrom pathlib import Path\n\nALIASES",
    )
    (ROOT / "backend" / "frontend_aliases.py").write_text(text + "\n", encoding="utf-8")


def main() -> None:
    mapping = load_map()
    moved, overwritten, deleted = sync_and_drop_root(mapping)
    notes = move_leftovers(mapping)
    MAP_PATH.write_text(json.dumps(mapping, indent=2) + "\n", encoding="utf-8")
    changed = rewrite_all_dest(mapping)
    dump_aliases(mapping)
    leftover = sorted(
        p.name
        for p in FRONTEND.iterdir()
        if p.is_file() and p.name not in SKIP_ROOT
    )
    print(f"moved={moved} overwritten_from_newer_root={overwritten} deleted_root={deleted} rewrote={changed}")
    print("leftover_root_files:", leftover)
    print("notes:", notes)


if __name__ == "__main__":
    main()
