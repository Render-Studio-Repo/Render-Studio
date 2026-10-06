"""Revision-bound review packets; generation success and peer votes are not inspection."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

REQUIRED_CHECKS = ("geometry", "dimensions", "assembly_motion", "manufacturability", "visual")


def _file(root: Path, name: str) -> Path:
    path = (root / name).resolve()
    if not path.is_relative_to(root.resolve()) or not path.is_file():
        raise ValueError(f"Inspection file missing or outside project: {name}")
    return path


def _digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _artifacts(root: Path, path: Path) -> dict:
    paths = {path}
    for suffix in (".glb", ".joints.json", ".brief.md"):
        sibling = path.with_suffix(suffix)
        if sibling.is_file():
            paths.add(_file(root, sibling.relative_to(root).as_posix()))
    return {p.relative_to(root).as_posix(): _digest(p) for p in sorted(paths)}


def prepare_inspection(root: Path, published: str | Path) -> dict:
    root = Path(root).resolve()
    candidate = Path(published)
    if candidate.is_absolute():
        candidate = candidate.relative_to(root)
    path = _file(root, candidate.as_posix())
    artifacts = _artifacts(root, path)
    revision = hashlib.sha256(json.dumps(artifacts, sort_keys=True).encode()).hexdigest()
    packet = {
        "schema": "render.cad-inspection.v1", "artifact_revision": revision,
        "published_model": candidate.as_posix(), "artifacts": artifacts, "status": "unverified", "all_passed": False,
        "required_checks": list(REQUIRED_CHECKS), "reviews": [],
        "instructions": "Inspect these exact files. Return a named reviewer, artifact_revision, and checks with status pass/fail/not_applicable, reason, and project-relative evidence files. Missing measurements, screenshots or solver results remain unverified. Explain not_applicable. Peer agreement alone is not evidence.",
    }
    destination = path.with_suffix(".inspection.json")
    # A rerun on the same bytes must not erase completed reviews.
    if destination.is_file():
        try:
            previous = json.loads(destination.read_text())
            if previous.get("artifact_revision") == revision:
                packet["reviews"] = previous.get("reviews", [])
        except (ValueError, OSError):
            pass
    result = inspection_status(root, packet)
    packet.update(result)
    destination.write_text(json.dumps(packet, indent=2) + "\n")
    return {**result, "packet": destination.relative_to(root).as_posix(), "artifact_revision": revision}


def inspection_status(root: Path, packet: dict) -> dict:
    """Revalidate file bytes every read; never carry a verdict across edits."""
    artifacts = packet.get("artifacts") or {}
    try:
        if not artifacts or _artifacts(root.resolve(), _file(root, packet.get("published_model") or "")) != artifacts:
            return {"status": "stale", "all_passed": False}
    except (OSError, ValueError):
        return {"status": "stale", "all_passed": False}
    verified = set()
    for review in packet.get("reviews", []):
        if review.get("artifact_revision") != packet.get("artifact_revision"):
            continue
        for name, check in review.get("checks", {}).items():
            if check.get("status") == "fail":
                return {"status": "failed", "all_passed": False}
            evidence = check.get("evidence") or {}
            try:
                valid = bool(evidence) and all(_digest(_file(root, n)) == h for n, h in evidence.items())
            except (OSError, ValueError):
                valid = False
            if valid and check.get("reason") and check.get("status") in {"pass", "not_applicable"}:
                verified.add(name)
    complete = set(REQUIRED_CHECKS).issubset(verified)
    return {"status": "reviewed" if complete else "unverified", "all_passed": complete}


def record_inspection(root: Path, packet_name: str, review: dict) -> dict:
    path = _file(root, packet_name)
    packet = json.loads(path.read_text())
    if inspection_status(root, packet)["status"] == "stale" or review.get("artifact_revision") != packet.get("artifact_revision"):
        raise ValueError("Review is for a stale model revision")
    reviewer = str(review.get("reviewer") or "").strip()
    if not reviewer:
        raise ValueError("Named reviewer required")
    checks = {}
    for name, check in (review.get("checks") or {}).items():
        if name not in REQUIRED_CHECKS or check.get("status") not in {"pass", "fail", "not_applicable"}:
            raise ValueError("Unknown inspection check or status")
        evidence = check.get("evidence")
        if not check.get("reason") or not isinstance(evidence, list) or not evidence:
            raise ValueError("Each verdict requires a reason and evidence files")
        checks[name] = {"status": check["status"], "reason": str(check["reason"]),
                        "evidence": {n: _digest(_file(root, n)) for n in evidence}}
    if not checks:
        raise ValueError("No inspection checks supplied")
    packet["reviews"].append({"reviewer": reviewer, "artifact_revision": packet["artifact_revision"], "checks": checks})
    packet.update(inspection_status(root, packet))
    path.write_text(json.dumps(packet, indent=2) + "\n")
    return packet


def main():
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('prepare', 'status', 'record'))
    parser.add_argument('project', type=Path)
    parser.add_argument('file', help='Published model for prepare; inspection packet otherwise')
    parser.add_argument('--review', type=Path, help='Reviewer JSON, required for record')
    args = parser.parse_args()
    if args.action == 'prepare':
        result = prepare_inspection(args.project, args.file)
    elif args.action == 'record':
        if not args.review:
            parser.error('--review is required for record')
        result = record_inspection(args.project, args.file, json.loads(args.review.read_text()))
    else:
        packet = json.loads(_file(args.project, args.file).read_text())
        result = inspection_status(args.project, packet)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
