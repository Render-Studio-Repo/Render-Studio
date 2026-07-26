"""Adapt img2threejs forge TypeScript factories into headless `.mjs` for GLB export."""

from __future__ import annotations

import re


_SKIP_IMPORT_PREFIXES = (
    "import { RoomEnvironment",
    "import { EffectComposer",
    "import { RenderPass",
    "import { BokehPass",
    "import { UnrealBloomPass",
)

_SIMPLE_TYPE = re.compile(
    r"^(?:"
    r"string|number|boolean|any|unknown|void|never|object|null|undefined|"
    r"THREE\.[\w.]+|Record<|Partial<|Readonly<|Array<|Promise<|"
    r"Sculpt\w*|Procedural\w*|[A-Z][\w.]*(?:<[^;]+>)?"
    r")(?:\[\])*$"
)


def _is_type_annotation(typ: str) -> bool:
    typ = typ.strip()
    if not typ:
        return False
    if typ.startswith("["):
        # Tuple type `[number, number]` vs value `[0, 1]`
        return bool(re.search(r"\b(?:string|number|boolean|any|unknown)\b", typ))
    if typ.startswith("{") or typ.startswith("("):
        return True
    return bool(_SIMPLE_TYPE.match(typ.split("=", 1)[0].strip()))


def _strip_param_list_types(params: str) -> str:
    """Strip TypeScript types from a parameter list, keeping defaults."""
    parts: list[str] = []
    buf = ""
    depth = 0
    for ch in params:
        if ch in "<([{":
            depth += 1
        elif ch in ">)]}":
            depth = max(0, depth - 1)
        if ch == "," and depth == 0:
            parts.append(buf)
            buf = ""
        else:
            buf += ch
    parts.append(buf)

    cleaned: list[str] = []
    for part in parts:
        raw = part.strip()
        if not raw:
            continue
        # Split default at top-level '='
        default = ""
        core = raw
        eq_depth = 0
        for i, ch in enumerate(raw):
            if ch in "<([{":
                eq_depth += 1
            elif ch in ">)]}":
                eq_depth = max(0, eq_depth - 1)
            elif ch == "=" and eq_depth == 0:
                core = raw[:i].strip()
                default = raw[i:].strip()
                break
        m = re.match(r"^(\.\.\.)?([A-Za-z_]\w*)\??\s*(?::\s*(.+))?$", core, re.S)
        if m and m.group(3) is not None and _is_type_annotation(m.group(3)):
            name = f"{m.group(1) or ''}{m.group(2)}"
            cleaned.append(f"{name} {default}".strip() if default else name)
        else:
            cleaned.append(raw)
    return ", ".join(cleaned)


def _strip_function_param_types(text: str) -> str:
    """Strip types in `function foo(...)` / `(word)\(` parameter lists only."""
    out: list[str] = []
    i = 0
    n = len(text)
    # Match "function name(" or "name(" after export/async/whitespace — avoid call sites
    # by requiring function keyword OR being an arrow param list handled separately.
    pattern = re.compile(
        r"(?P<pre>\bfunction\s+[A-Za-z_]\w*\s*)\("
        r"|(?P<pre2>\bexport\s+function\s+[A-Za-z_]\w*\s*)\("
    )
    while i < n:
        m = pattern.search(text, i)
        if not m:
            out.append(text[i:])
            break
        start = m.end() - 1  # position of '('
        out.append(text[i:start])
        # scan balanced params
        depth = 0
        j = start
        while j < n:
            if text[j] == "(":
                depth += 1
            elif text[j] == ")":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        if depth != 0:
            out.append(text[start:])
            break
        inner = text[start + 1 : j]
        out.append("(" + _strip_param_list_types(inner) + ")")
        i = j + 1
    return "".join(out)


def _strip_arrow_param_types(text: str) -> str:
    """Strip `(item: unknown) =>` style arrow params (single-segment lists)."""
    def repl(match: re.Match[str]) -> str:
        inner = match.group(1)
        return "(" + _strip_param_list_types(inner) + ") =>"

    return re.sub(r"\(([^\n()]*)\)\s*=>", repl, text)


def forge_ts_to_mjs(ts_source: str, *, model_fn: str, type_name: str) -> str:
    """Strip TypeScript syntax from forge codegen and add createModel(_THREE) default export.

    Headless export has no document/canvas; procedural CanvasTextures already no-op when
    `document` is undefined. Look-dev / postprocessing helpers are dropped — they are not
    part of the exported Group.
    """
    src = ts_source or ""
    cut: int | None = None
    for marker in (
        f"export function create{type_name}LookDevLights",
        f"export function create{type_name}Environment",
        f"export function frame{type_name}Camera",
        f"export function create{type_name}PresentationComposer",
    ):
        idx = src.find(marker)
        if idx > 0:
            cut = idx if cut is None else min(cut, idx)
    if cut is not None:
        src = src[:cut].rstrip() + "\n"

    out_lines: list[str] = []
    skipping_type = False
    brace_depth = 0
    for line in src.splitlines():
        s = line.strip()
        if any(s.startswith(prefix) for prefix in _SKIP_IMPORT_PREFIXES):
            continue
        if re.match(r"^(export\s+)?type\s+\w+", s):
            skipping_type = True
            brace_depth = s.count("{") - s.count("}")
            if brace_depth <= 0 and (s.endswith(";") or "{" not in s):
                skipping_type = False
            continue
        if skipping_type:
            brace_depth += s.count("{") - s.count("}")
            if brace_depth <= 0:
                skipping_type = False
            continue
        out_lines.append(line)

    text = "\n".join(out_lines)
    text = re.sub(r"\s+satisfies\s+\w+", "", text)
    # Strip `value as Type` assertions, but never `import * as THREE` or prose "as the…".
    text = re.sub(
        r"(?<!\*)\s+as\s+(?:const\b|(?:string|number|boolean|any|unknown|void|never|object)|"
        r"[A-Z][\w.<>,\s|&\[\]'\"|?]*)",
        "",
        text,
    )
    text = re.sub(r"\)\s*:\s*[\w.\s]+\bis\s+[\w.<>,\s|&\[\]]+\s*=>", ") =>", text)
    text = re.sub(r"\)\s*:\s*[^{=\n]+(?=\{)", ") ", text)
    text = re.sub(r"\b(const|let|var)\s+(\w+)\s*:\s*[^=;\n]+", r"\1 \2", text)
    text = _strip_function_param_types(text)
    text = _strip_arrow_param_types(text)

    text = text.rstrip() + "\n"
    text += (
        f"\nexport default function createModel(_THREE) {{\n"
        f"  return {model_fn}({{}});\n"
        f"}}\n"
    )
    return text
