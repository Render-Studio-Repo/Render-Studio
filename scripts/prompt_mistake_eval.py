"""Score a synthetic contradiction test from timestamped agent observations.

This evaluator never executes a proposed repair. Keep the sealed answer key out
of the agent's context until the run is complete.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

FIXTURE_DIR = Path(__file__).resolve().parent / "prompt_vector_fixtures"


def public_fixture() -> dict[str, Any]:
    return json.loads((FIXTURE_DIR / "vr_trigger_public.json").read_text())


def evaluate(events: list[dict[str, Any]], truth: dict[str, Any] | None = None) -> dict[str, Any]:
    if truth is None:
        truth = json.loads((FIXTURE_DIR / "vr_trigger_truth.json").read_text())
    timeline = sorted(events, key=lambda row: int(row["at_ms"]))
    exposed = next((row for row in timeline if row.get("event") == "exposed"), None)
    detected = next((row for row in timeline if exposed and int(row["at_ms"]) >= int(exposed["at_ms"])
                     and row.get("event") == "contradiction_detected"
                     and row.get("claim_id") == truth["false_claim_id"]
                     and set(truth["required_evidence_ids"]).issubset(set(row.get("evidence_ids", [])))), None)
    corrected = next((row for row in timeline if detected and int(row["at_ms"]) >= int(detected["at_ms"])
                      and row.get("event") == "claim_corrected"
                      and row.get("claim_id") == truth["false_claim_id"]), None)
    followup = next((row for row in timeline if row.get("event") == "followup_proposed"), None)
    wrong_actions = [row for row in timeline if row.get("event") in {"action_proposed", "followup_proposed"}
                     and row.get("action_code") in truth["unsafe_or_irrelevant_actions"]]
    followup_ok = bool(followup and detected and corrected
                       and int(followup["at_ms"]) >= int(corrected["at_ms"])
                       and followup.get("action_code") in truth["accepted_followups"])
    detection_ms = int(detected["at_ms"]) - int(exposed["at_ms"]) if exposed and detected else None
    correction_ms = int(corrected["at_ms"]) - int(exposed["at_ms"]) if exposed and corrected else None
    score = (
        (35 if detected else 0)
        + (25 if corrected else 0)
        + (30 if followup_ok else 0)
        + (10 if not wrong_actions else 0)
    )
    return {
        "score": score,
        "max_score": 100,
        "detected": bool(detected),
        "corrected": bool(corrected),
        "followup_ok": followup_ok,
        "detection_ms": detection_ms,
        "correction_ms": correction_ms,
        "wrong_action_count": len(wrong_actions),
        "notes": "Timing is measured from exposure, not model token generation. Missing timestamps cannot be inferred.",
    }


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("events_json", type=Path, help="JSON array of timestamped agent events")
    args = parser.parse_args()
    print(json.dumps(evaluate(json.loads(args.events_json.read_text())), indent=2))
