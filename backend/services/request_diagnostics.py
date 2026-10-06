"""On-demand, stack-only diagnostics for a stalled HTTP process (POSIX)."""
from __future__ import annotations

import faulthandler
import signal


def enable_request_stack_dump() -> None:
    """SIGUSR1 records thread stacks to stderr without ending requests.

    faulthandler also works when Python's GIL is held by a native CAD operation.
    No request bodies, credentials, locals, or model contents are recorded.
    """
    if hasattr(signal, "SIGUSR1"):
        faulthandler.register(signal.SIGUSR1, all_threads=True)
