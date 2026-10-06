"""Five ordered research roles. Votes prioritize; observed test gates determine confirmation."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from watchdogs import inspect

ORDER = ("intake", "investigator", "skeptic", "test_runner", "adjudicator")
WEIGHT = {"intake": 1, "investigator": 1, "skeptic": 1, "test_runner": 2, "adjudicator": 1}
VOTE = {"support": 1, "reject": -1, "abstain": 0}


def evaluate(case: dict) -> dict:
    findings = inspect(case)
    evidence = {item["id"]: item for item in case.get("evidence", [])}
    evidence_ids = set(evidence)
    results = []
    for hypothesis in case.get("hypotheses", []):
        votes = hypothesis.get("votes", [])
        roles = [row.get("role") for row in votes]
        if roles != list(ORDER):
            raise ValueError(f"{hypothesis['id']}: five votes must follow the required role order")
        for vote in votes:
            if vote.get("value") not in VOTE:
                raise ValueError(f"{hypothesis['id']}: invalid vote")
            if not set(vote.get("evidence_ids", [])).issubset(evidence_ids):
                raise ValueError(f"{hypothesis['id']}: vote cites unknown evidence")
        weighted_vote = sum(WEIGHT[row["role"]] * VOTE[row["value"]] for row in votes)
        prediction_check = hypothesis.get("prediction_check", {})
        observed = evidence.get(prediction_check.get("evidence_id"), {}).get("facts", {}).get(prediction_check.get("field"))
        has_observation = prediction_check.get("field") in evidence.get(prediction_check.get("evidence_id"), {}).get("facts", {})
        contradicted = has_observation and observed != prediction_check.get("equals")
        passed_prediction = has_observation and observed == prediction_check.get("equals")
        if contradicted:
            status = "eliminated"
            reason = "Reliable evidence contradicts a required prediction"
        elif not passed_prediction:
            status = "untested"
            reason = "Discriminating prediction has not passed"
        elif weighted_vote <= 0:
            status = "needs_review"
            reason = "Votes do not prioritize this candidate"
        else:
            status = "survives"
            reason = "Candidate merits a fix verification attempt"
        results.append({"hypothesis_id": hypothesis["id"], "status": status,
                        "weighted_vote": weighted_vote, "max_vote": sum(WEIGHT.values()),
                        "reason": reason})

    gate_failures = []
    verification = case.get("verification", {})
    before = evidence.get(verification.get("before_evidence_id"), {})
    after = evidence.get(verification.get("after_evidence_id"), {})
    if before.get("facts", {}).get("trigger_status") != "broken":
        gate_failures.append("no evidence-backed pre-fix failure")
    if after.get("facts", {}).get("trigger_status") != "ok":
        gate_failures.append("no evidence-backed post-fix recovery")
    if not case.get("patch_ref"):
        gate_failures.append("no patch/version reference")
    if any(f["severity"] == "critical" for f in findings):
        gate_failures.append("critical watchdog finding")
    if any(f["code"] in {"mandatory_not_ok", "feature_unchecked", "environment_mismatch",
                            "missing_evidence", "unattributed_pass"} for f in findings):
        gate_failures.append("required evidence or check is missing")
    surviving = [r for r in results if r["status"] == "survives"]
    verdict = "confirmed" if surviving and not gate_failures else "unverified"
    if any(f["code"] == "feature_regression" for f in findings):
        verdict = "rejected"
    return {"verdict": verdict, "gate_failures": gate_failures,
            "hypotheses": results, "watchdog_findings": findings}


def main() -> None:
    case = json.loads(Path(sys.argv[1]).read_text())
    print(json.dumps(evaluate(case), indent=2))


if __name__ == "__main__":
    main()
