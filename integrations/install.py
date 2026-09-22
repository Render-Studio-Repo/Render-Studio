#!/usr/bin/env python3
"""Install / refresh integrations using repo-relative paths only.

Examples:
  python integrations/install.py --list
  python integrations/install.py dimos
  python integrations/install.py --all
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

try:
    from paths import integration_dir, integrations_root, repo_root
except ImportError:  # python -m integrations.install from repo root
    from integrations.paths import integration_dir, integrations_root, repo_root


def _load_manifest() -> dict:
    path = integrations_root() / "MANIFEST.json"
    return json.loads(path.read_text(encoding="utf-8"))


def _run(cmd: list[str], cwd: Path | None = None) -> None:
    print("+", " ".join(cmd))
    subprocess.run(cmd, cwd=str(cwd) if cwd else None, check=True)


def _is_upstream_checkout(dest: Path) -> bool:
    """True when dest looks like a real upstream tree (not just our stub README)."""
    return (dest / "pyproject.toml").is_file() and (
        (dest / "dimos").is_dir() or (dest / "setup.py").is_file()
    )


def install_git_shallow(entry: dict) -> None:
    dest = integration_dir(entry["path"])
    github = entry["github"]
    ref = entry.get("default_ref") or "main"
    marker = dest / ".render-studio-source.json"
    stub_readme = dest / "README.md"

    if _is_upstream_checkout(dest):
        print(f"[ok] {entry['id']}: already installed → {dest.relative_to(repo_root())}")
        if not marker.is_file():
            marker.write_text(
                json.dumps({"github": github, "ref": ref, "mode": "git_shallow"}, indent=2) + "\n",
                encoding="utf-8",
            )
        if (dest / ".git").is_dir():
            try:
                _run(["git", "fetch", "--depth", "1", "origin", ref], cwd=dest)
                _run(["git", "checkout", "FETCH_HEAD"], cwd=dest)
            except subprocess.CalledProcessError as exc:
                print(f"[warn] could not update {entry['id']}: {exc}")
        return

    # Preserve stub README text, then clone into a temp dir and swap in.
    preserved_readme = stub_readme.read_text(encoding="utf-8") if stub_readme.is_file() else None
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.parent / f".{entry['path']}.clone-tmp"
    if tmp.exists():
        shutil.rmtree(tmp)
    if dest.exists() and not _is_upstream_checkout(dest):
        # Remove stub-only contents so clone can use the final path.
        shutil.rmtree(dest)

    try:
        _run(["git", "clone", "--depth", "1", "--branch", ref, github, str(tmp)])
        # Drop nested LFS requirement for Render Studio consumers; assets stay as pointers.
        # (Upstream may still use LFS; incomplete media does not block Python package use.)
        tmp.rename(dest)
    except Exception:
        if tmp.exists():
            shutil.rmtree(tmp, ignore_errors=True)
        raise

    marker.write_text(
        json.dumps({"github": github, "ref": ref, "mode": "git_shallow"}, indent=2) + "\n",
        encoding="utf-8",
    )
    # Keep a Render-Studio-oriented note alongside upstream README if we had a stub.
    if preserved_readme and "Render Studio" in preserved_readme:
        (dest / "README.render-studio.md").write_text(preserved_readme, encoding="utf-8")
    print(f"[ok] cloned {entry['id']} → {dest.relative_to(repo_root())}")


def install_entry(entry: dict) -> None:
    mode = entry.get("install") or "docs_only"
    dest = integration_dir(entry["path"])
    dest.mkdir(parents=True, exist_ok=True)
    readme = dest / "README.md"
    if mode == "git_shallow":
        install_git_shallow(entry)
        return
    if mode in {"local", "docs_only"}:
        if readme.is_file():
            print(f"[ok] {entry['id']}: see {readme.relative_to(repo_root())}")
        else:
            print(f"[warn] {entry['id']}: missing README at {readme}")
        return
    print(f"[warn] {entry['id']}: unknown install mode {mode!r}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("names", nargs="*", help="Integration ids (default: none)")
    parser.add_argument("--all", action="store_true", help="Install/refresh every manifest entry")
    parser.add_argument("--list", action="store_true", help="List integrations")
    args = parser.parse_args(argv)

    root = repo_root()
    print(f"repo root: {root}")
    print(f"integrations: {integrations_root()}")

    manifest = _load_manifest()
    entries = manifest.get("integrations") or []
    by_id = {e["id"]: e for e in entries}

    if args.list or (not args.names and not args.all):
        for entry in entries:
            print(f"- {entry['id']:16} {entry.get('github') or 'local':<48} {entry.get('summary', '')}")
        if not args.list and not args.names and not args.all:
            print("\nPass an id, --all, or --list.")
        return 0

    selected = entries if args.all else [by_id[n] for n in args.names if n in by_id]
    missing = [n for n in args.names if n not in by_id]
    for name in missing:
        print(f"[error] unknown integration id: {name}", file=sys.stderr)
    for entry in selected:
        install_entry(entry)
    return 1 if missing else 0


if __name__ == "__main__":
    # Allow running as `python integrations/install.py` without package install.
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    raise SystemExit(main())
