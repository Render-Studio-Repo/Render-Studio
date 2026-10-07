"""Deterministic evidence checks. Example input is synthetic; no network or patch execution."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path


def digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def inspect(case: dict) -> list[dict]:
    findings: list[dict] = []

    def flag(code: str, severity: str, detail: str) -> None:
        findings.append({"code": code, "severity": severity, "detail": detail})

    document = case.get("document", {})
    source = document.get("source", "")
    if digest(source) != document.get("sha256"):
        flag("source_hash_mismatch", "critical", "Original source differs from its recorded hash")
    chunks = sorted(document.get("chunks", []), key=lambda row: row["start_char"])
    covered = 0
    for chunk in chunks:
        start, end = chunk["start_char"], chunk["end_char"]
        if start < 0 or end > len(source) or start >= end:
            flag("invalid_span", "critical", chunk.get("id", "?"))
            continue
        if start > covered:
            flag("source_gap", "critical", f"Missing characters {covered}:{start}")
        if source[start:end] != chunk["text"] or digest(chunk["text"]) != chunk["sha256"]:
            flag("chunk_mismatch", "critical", chunk.get("id", "?"))
        covered = max(covered, end)
    if covered < len(source):
        flag("source_gap", "critical", f"Missing characters {covered}:{len(source)}")

    baseline = case.get("baseline", {})
    current = case.get("current", {})
    if baseline.get("environment") != current.get("environment"):
        flag("environment_mismatch", "high", "Feature states are not directly comparable")
    for feature, old in baseline.get("features", {}).items():
        new = current.get("features", {}).get(feature, "unknown")
        if old == "ok" and new in {"broken", "missing"}:
            flag("feature_regression", "critical", feature)
        if new == "unknown":
            flag("feature_unchecked", "high", feature)
    for feature in case.get("mandatory_features", []):
        if current.get("features", {}).get(feature) != "ok":
            flag("mandatory_not_ok", "high", feature)

    known_ids = {e["id"] for e in case.get("evidence", [])}
    for hypothesis in case.get("hypotheses", []):
        for evidence_id in hypothesis.get("support_ids", []) + hypothesis.get("contradict_ids", []):
            if evidence_id not in known_ids:
                flag("missing_evidence", "high", f"{hypothesis['id']} cites {evidence_id}")
    for check in case.get("checks", []):
        if check.get("status") == "ok" and not check.get("source_ref"):
            flag("unattributed_pass", "high", check.get("feature_id", "?"))
    return findings


def main() -> None:
    case = json.loads(Path(sys.argv[1]).read_text())
    print(json.dumps({"findings": inspect(case)}, indent=2))


if __name__ == "__main__":
    main()
