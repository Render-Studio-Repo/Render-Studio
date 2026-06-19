"""Design-for-manufacturing (DFM) checks.

Validates that generated geometry is actually manufacturable: watertight/manifold
solids, adequate wall thickness, sane hole sizes, and overhang/printability hints.
Results are surfaced as warnings in the prompt response and fed back to the AI
self-repair loop.
"""

from backend.dfm.checks import DEFAULT_PROCESS, run_dfm_checks

__all__ = ["DEFAULT_PROCESS", "run_dfm_checks"]
