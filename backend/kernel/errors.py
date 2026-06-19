"""Kernel exception types — no heavy dependencies (no build123d / OCCT).

Keeping exceptions in a separate module allows lightweight API workers and
schema-only code paths to catch KernelBuildError without importing build123d.
"""

from __future__ import annotations


class KernelBuildError(ValueError):
    """Raised when a feature program cannot be realised into valid geometry."""
