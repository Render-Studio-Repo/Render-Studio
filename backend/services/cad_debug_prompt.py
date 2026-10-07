"""CAD Debug toggle — origin for debug prompt text (Jake / VibeCAD / MAC).

Not the XR stick debugger. When the studio Debug chip is on, Improve + Generate
include a CAD DEBUG BRIEF (last error, selected bodies, units, engine) so the
harness can diagnose failed kernel runs instead of rewriting a generic prompt.
"""

from __future__ import annotations

from typing import Any

CAD_DEBUG_MARKER = "CAD DEBUG BRIEF:"

CAD_DEBUG_SYSTEM = """CAD DEBUG MODE is ON for this run (studio Debug toggle).
This is a parametric CAD debug prompt, not XR, not Render Agent.
Use the CAD DEBUG BRIEF as ground truth: last generation/kernel error, selected bodies,
display units, and the active harness (Jake / VibeCAD / MAC).
Diagnose the failure, then author a revised model that addresses that error.
Keep units, named bodies, and the user's design intent. Prefer kernel-safe operations.
Do not invent a different product. Do not mention that you are debugging unless the brief needs it.
"""

CAD_DEBUG_IMPROVE_SYSTEM = """CAD DEBUG MODE is ON (studio Debug toggle, session sticky until turned off).
Rewrite improved_prompt as a CAD *debug* prompt: fold last error, selected bodies, units, and engine
into explicit constraints so Generate can fix the kernel/harness failure.
Keep a trailing block that starts with exactly `CAD DEBUG BRIEF:` summarizing those facts
(last error, bodies, units, engine). Do not drop the user's part intent.
This is not an XR debugger session and must not become a Render Agent conversation.
"""


def is_cad_debug_enabled(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"1", "true", "on", "yes"}


def _clip(text: str, limit: int) -> str:
    raw = str(text or "").strip()
    if len(raw) <= limit:
        return raw
    return raw[: max(0, limit - 1)].rstrip() + "…"


def format_cad_debug_brief(brief: str | dict[str, Any] | None, *, max_chars: int = 6000) -> str:
    if not brief:
        return ""
    if isinstance(brief, str):
        text = brief.strip()
        if not text:
            return ""
        if CAD_DEBUG_MARKER in text:
            return _clip(text, max_chars)
        return _clip(f"{CAD_DEBUG_MARKER}\n{text}", max_chars)
    if not isinstance(brief, dict):
        return ""
    lines = [CAD_DEBUG_MARKER]
    engine = str(brief.get("engine") or "").strip()
    units = str(brief.get("units") or "").strip()
    bodies = brief.get("bodies") or brief.get("selected_bodies") or ""
    error = str(brief.get("last_error") or brief.get("error") or "").strip()
    logs = str(brief.get("kernel_logs") or brief.get("logs") or "").strip()
    if engine:
        lines.append(f"- Engine: {engine}")
    if units:
        lines.append(f"- Units: {units}")
    if isinstance(bodies, (list, tuple)):
        names = [str(b).strip() for b in bodies if str(b).strip()]
        if names:
            lines.append("- Selected bodies: " + ", ".join(names[:24]))
    elif str(bodies).strip():
        lines.append(f"- Selected bodies: {str(bodies).strip()}")
    if error:
        lines.append("- Last error:\n" + _clip(error, 1800))
    if logs:
        lines.append("- Kernel / harness logs:\n" + _clip(logs, 1800))
    extra = str(brief.get("notes") or "").strip()
    if extra:
        lines.append("- Notes: " + _clip(extra, 400))
    if len(lines) <= 1:
        return ""
    return _clip("\n".join(lines), max_chars)


def apply_cad_debug_to_prompt(
    prompt: str,
    *,
    enabled: bool,
    brief: str | dict[str, Any] | None = None,
    max_chars: int = 100_000,
) -> str:
    text = str(prompt or "").strip()
    if not enabled:
        return text
    block = format_cad_debug_brief(brief)
    if not block:
        block = (
            f"{CAD_DEBUG_MARKER}\n"
            "- Debug toggle is on. Diagnose using any prior kernel error, selected solids, units, and engine."
        )
    if CAD_DEBUG_MARKER in text:
        return text[:max_chars]
    merged = f"{text}\n\n{block}".strip() if text else block
    return merged[:max_chars]
