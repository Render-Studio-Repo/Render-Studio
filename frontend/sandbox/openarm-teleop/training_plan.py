"""Decision rule for *evaluation* episodes and additional demonstration batches.

No model is trained here. Holdout results must be recorded by an external evaluator.
"""

from __future__ import annotations

import math
from typing import Any


def wilson_lower(successes: int, trials: int, z: float = 1.96) -> float:
    if trials <= 0:
        return 0.0
    p = successes / trials
    z2 = z * z
    return max(0.0, (p + z2 / (2 * trials) - z * math.sqrt(p * (1 - p) / trials + z2 / (4 * trials * trials))) / (1 + z2 / trials))


def next_step(holdout: list[dict[str, Any]], *, target_lower: float = 0.80,
              min_trials: int = 20, max_trials: int = 60) -> dict[str, Any]:
    """Use independent, previously unseen trials; never train on this holdout."""
    n = len(holdout)
    successes = sum(1 for row in holdout if row.get("success") is True)
    hard_violations = sum(int(row.get("hard_limit_violations", 0)) for row in holdout)
    invalid = sum(1 for row in holdout if row.get("valid") is not True)
    lower = wilson_lower(successes, n)
    failures = [row.get("failure_mode", "unknown") for row in holdout if row.get("success") is False]
    mode = max(set(failures), key=failures.count) if failures else None
    if invalid or hard_violations:
        action = "repair_harness_or_safety_gate"
    elif n >= min_trials and lower >= target_lower:
        action = "stop_and_report_heldout_success"
    elif n >= max_trials:
        action = "stop_budget_exhausted_and_review"
    elif mode:
        action = "collect_5_new_demos_for_failure_mode_then_retrain"
    else:
        action = "run_5_more_heldout_trials"
    return {
        "action": action, "heldout_trials": n, "successes": successes,
        "wilson_95_lower": round(lower, 3), "target_lower": target_lower,
        "hard_limit_violations": hard_violations, "invalid_trials": invalid,
        "priority_failure_mode": mode,
        "note": "A demo batch is a heuristic; train with the real policy pipeline and evaluate on untouched holdout episodes."
    }
