#!/usr/bin/env python3
"""Repository Governance gate — run before git push.

Exit 0 = safe to continue. Non-zero = do not push.
"""

from __future__ import annotations

import argparse
import fnmatch
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GOV = ROOT / "repository-governance"


def _load_yaml_lite(path: Path) -> dict:
    """Minimal YAML subset loader (no PyYAML dependency required)."""
    try:
        import yaml  # type: ignore

        return yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except Exception:
        pass
    data: dict = {"paths": [], "allow": [], "content_scan": {}}
    section = None
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].rstrip()
        if not line.strip():
            continue
        if re.match(r"^[a-zA-Z_][\w]*:\s*$", line.strip()):
            section = line.strip().rstrip(":")
            if section not in data:
                data[section] = [] if section in {"paths", "allow"} else {}
            continue
        if section in {"paths", "allow"} and line.strip().startswith("- "):
            item = line.strip()[2:].strip().strip('"').strip("'")
            data[section].append(item)
        elif section == "content_scan" and ":" in line:
            key, val = line.strip().split(":", 1)
            data.setdefault("content_scan", {})[key.strip()] = val.strip()
    return data


def _git(args: list[str]) -> str:
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True)


def _list_candidate_paths(staged: bool) -> list[str]:
    if staged:
        out = _git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"])
        return [p for p in out.splitlines() if p.strip()]
    # Default: changed + untracked (what a careless `git add -A` would pick up),
    # not the entire historical tree (legacy tracked noise is cleaned separately).
    changed = _git(["diff", "--name-only", "--diff-filter=ACMR"]).splitlines()
    staged_paths = _git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]).splitlines()
    untracked = _git(["ls-files", "--others", "--exclude-standard"]).splitlines()
    merged = []
    seen = set()
    for p in staged_paths + changed + untracked:
        p = p.strip()
        if p and p not in seen:
            seen.add(p)
            merged.append(p)
    return merged


def _matches(path: str, pattern: str) -> bool:
    pat = pattern.strip()
    if pat.startswith("!"):
        return False
    # Normalize ** globs for fnmatch
    if pat.endswith("/**"):
        prefix = pat[:-3]
        return path == prefix or path.startswith(prefix.rstrip("/") + "/")
    if "**" in pat:
        # Convert simple ** globs to regex
        rx = re.escape(pat).replace(r"\*\*", ".*").replace(r"\*", "[^/]*")
        return re.fullmatch(rx, path) is not None
    return fnmatch.fnmatch(path, pat) or path == pat.rstrip("/")


def _is_fenced(path: str, fence_paths: list[str]) -> bool:
    negated = [p[1:] for p in fence_paths if p.startswith("!")]
    if any(_matches(path, n) for n in negated):
        return False
    return any(_matches(path, p) for p in fence_paths if not p.startswith("!"))


def _is_allowed(path: str, allow: list[str]) -> bool:
    if path.startswith("repository-governance/"):
        return True
    return any(_matches(path, p) for p in allow)


def _load_patterns(path: Path) -> list[re.Pattern[str]]:
    patterns: list[re.Pattern[str]] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        try:
            patterns.append(re.compile(line))
        except re.error as exc:
            print(f"WARN: bad secret pattern {line!r}: {exc}", file=sys.stderr)
    return patterns


def _scan_secrets(paths: list[str], patterns: list[re.Pattern[str]], skip_ext: set[str]) -> list[str]:
    hits: list[str] = []
    skip_dir_bits = ("/dist/", "/node_modules/", "/.venv/", "/snap/")
    for rel in paths:
        p = ROOT / rel
        if not p.is_file():
            continue
        if p.suffix.lower() in skip_ext:
            continue
        if any(bit in f"/{rel.replace(chr(92), '/')}/" for bit in skip_dir_bits):
            continue
        if rel.endswith(".map") or rel.endswith("secret-patterns.txt") or rel.endswith(".env.example"):
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for pat in patterns:
            if pat.search(text):
                hits.append(f"{rel} matches /{pat.pattern}/")
                break
    return hits


def main() -> int:
    parser = argparse.ArgumentParser(description="Repository Governance publish gate")
    parser.add_argument("--staged", action="store_true", help="Only check staged files")
    parser.add_argument("--json", action="store_true", help="Print machine-readable summary")
    args = parser.parse_args()

    if not GOV.is_dir():
        print("FAIL: repository-governance/ missing", file=sys.stderr)
        return 2

    fence = _load_yaml_lite(GOV / "fence.yaml")
    manifest = _load_yaml_lite(GOV / "publish-manifest.yaml")
    off_limits = _load_yaml_lite(GOV / "off-limits.yaml") if (GOV / "off-limits.yaml").is_file() else {}
    fence_paths = list(fence.get("paths") or [])
    # Operator off-limits + hard premium fence always apply
    for extra in list(off_limits.get("paths") or []) + ["premium-features", "premium-features/**"]:
        if extra and extra not in fence_paths:
            fence_paths.append(extra)
    allow = list(manifest.get("allow") or [])
    content = fence.get("content_scan") or {}
    patterns_name = content.get("patterns_file") or "secret-patterns.txt"
    skip_ext = {e if e.startswith(".") else f".{e}" for e in (content.get("skip_extensions") or [])}
    # When using lite loader, skip_extensions may be a string — ignore then
    if not isinstance(next(iter(skip_ext), None), str) and skip_ext:
        skip_ext = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".woff", ".woff2", ".ico"}
    if not skip_ext:
        skip_ext = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".woff", ".woff2", ".ico"}

    # Prefer real YAML skip list if available
    try:
        import yaml  # type: ignore

        full = yaml.safe_load((GOV / "fence.yaml").read_text(encoding="utf-8")) or {}
        skip_ext = {
            (e if str(e).startswith(".") else f".{e}").lower()
            for e in ((full.get("content_scan") or {}).get("skip_extensions") or [])
        } or skip_ext
        fence_paths = list(full.get("paths") or fence_paths)
        off_full = {}
        if (GOV / "off-limits.yaml").is_file():
            off_full = yaml.safe_load((GOV / "off-limits.yaml").read_text(encoding="utf-8")) or {}
        for extra in list(off_full.get("paths") or []) + ["premium-features", "premium-features/**"]:
            if extra and extra not in fence_paths:
                fence_paths.append(extra)
        allow = list((yaml.safe_load((GOV / "publish-manifest.yaml").read_text(encoding="utf-8")) or {}).get("allow") or allow)
    except Exception:
        pass

    paths = _list_candidate_paths(staged=args.staged)
    fenced = [p for p in paths if _is_fenced(p, fence_paths)]
    disallowed = [p for p in paths if p not in fenced and not _is_allowed(p, allow)]

    patterns = _load_patterns(GOV / patterns_name) if (GOV / patterns_name).is_file() else []
    scan_targets = [p for p in paths if p not in fenced]
    secret_hits = _scan_secrets(scan_targets, patterns, skip_ext) if content.get("enabled", True) else []

    ok = not fenced and not disallowed and not secret_hits
    summary = {
        "ok": ok,
        "checked": len(paths),
        "fenced": fenced,
        "disallowed": disallowed,
        "secret_hits": secret_hits,
        "mode": "staged" if args.staged else "tracked",
    }

    if args.json:
        import json

        print(json.dumps(summary, indent=2))
    else:
        print(f"Repository Governance gate ({summary['mode']}): {len(paths)} path(s)")
        if fenced:
            print("FENCED (must not publish):")
            for p in fenced:
                print(f"  - {p}")
        if disallowed:
            print("NOT ON PUBLISH ALLOWLIST:")
            for p in disallowed:
                print(f"  - {p}")
        if secret_hits:
            print("SECRET PATTERN HITS:")
            for h in secret_hits:
                print(f"  - {h}")
        print("PASS" if ok else "FAIL — do not push")

    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
