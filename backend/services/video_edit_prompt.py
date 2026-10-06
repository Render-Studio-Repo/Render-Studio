"""Map a freeform video-edit prompt to a timeline plan, or rewrite it.

Used by /api/video/edit-prompt, /api/video/improve-prompt, and /api/video/film-edit.
"""
from __future__ import annotations

import json
import re
from typing import Any


ALLOWED_GRADES = {"none", "warm", "cool", "vivid", "noir"}
ALLOWED_TRANSITIONS = {"cut", "fade", "dissolve", "crossfade"}

SYSTEM_PROMPT = """You map a user's video-edit request to JSON for Render Studio's timeline editor.
Return a JSON object only, no markdown, with this shape:
{
  "transition": "cut" | "fade" | "dissolve" | null,
  "zoom": "in" | "out" | "none" | null,
  "fadeDuration": number | null,
  "keepAudio": true | false | null,
  "music": "enable" | "disable" | null,
  "summary": ["short phrase", ...]
}
Rules:
- This is a simple NLE: reorder, trim in/out, cut/fade/dissolve, optional zoom, optional music bed.
- dissolve is a crossfade. fade is fade-to-black between clips. cut is a hard cut.
- zoom "in" is a motivated push-in. Do not invent CAD or 3D-modeling language.
- Only set fields the user asked for. Unmentioned fields stay null / empty.
"""

IMPROVE_SYSTEM_PROMPT = """You rewrite a user's video-editing request into a stronger film-edit brief for Render Studio.
Return JSON only, no markdown:
{
  "improved_prompt": "the rewritten brief",
  "transition": "cut" | "fade" | "dissolve" | null,
  "zoom": "in" | "out" | "none" | null,
  "summary": ["short phrase", ...]
}
Rules:
- Keep the user's intent, numbers, clip order, and proper names.
- Use professional editorial language: pacing, motivated zooms, dissolves vs hard cuts, hold on key beats, audio bed, one continuous master clip.
- Do NOT convert this into CAD, Mode 2.0, Mesh, photoreal product shots, or shop-hex materials.
- Return only the JSON object.
"""


def local_improve_prompt(raw: str = "") -> str:
    text = str(raw or "").strip()
    if not text:
        return ""
    if re.search(r"\b(dissolve|crossfade|motivated zoom|hold on|pacing|master clip)\b", text, re.I) and len(text) > 80:
        return text
    return (
        f"{text}. Pro film edit: assemble into one continuous master, use motivated zooms on the "
        "subject, dissolve or fade between clips unless a hard cut is asked, keep pacing tight, "
        "hold on key beats, preserve source audio unless muted, export a share-ready clip."
    )


def timeline_plan(raw: str = "") -> dict[str, Any]:
    text = str(raw or "").strip()
    lower = text.lower()
    plan: dict[str, Any] = {
        "transition": None,
        "zoom": None,
        "fadeDuration": None,
        "keepAudio": None,
        "music": None,
        "summary": [],
    }
    if not text:
        return plan

    if re.search(r"\b(cross[\s-]?fade|dissolve)\b", lower):
        plan["transition"] = "dissolve"
        plan["summary"].append("dissolve")
    elif re.search(r"\b(fade in|transition in|fade between|fade to black)\b", lower):
        plan["transition"] = "fade"
        plan["summary"].append("fade")
    elif re.search(r"\b(hard cut|straight cut|cut only)\b", lower):
        plan["transition"] = "cut"
        plan["summary"].append("hard cuts")
    elif re.search(r"\btransition", lower) or re.search(r"\bfades?\b", lower):
        plan["transition"] = "fade"
        plan["summary"].append("fade")

    if re.search(r"\bzoom[\s-]?out\b", lower):
        plan["zoom"] = "out"
        plan["summary"].append("zoom out")
    elif re.search(r"\b(zooms?|ken burns|punch in|push in)\b", lower):
        plan["zoom"] = "in"
        plan["summary"].append("zoom in")

    dur = re.search(r"(?:fade|transition)\s*(?:for|of|=|:)?\s*(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds|ms)?", lower)
    if dur:
        n = float(dur.group(1))
        if (dur.group(2) or "s") == "ms":
            n /= 1000
        if n > 0:
            plan["fadeDuration"] = max(0.1, min(5.0, n))
            plan["summary"].append(f"{plan['fadeDuration']}s fades")

    if re.search(r"\b(mute|silent|no audio|hide audio)\b", lower) and "music" not in lower:
        plan["keepAudio"] = False
        plan["summary"].append("hide audio")
    if re.search(r"\b(add music|with music|music bed|soundtrack)\b", lower):
        plan["music"] = "enable"
        plan["summary"].append("music")
    return plan


def local_plan(raw: str = "") -> dict[str, Any]:
    text = str(raw or "").strip()
    lower = text.lower()
    plan: dict[str, Any] = {
        "keepAudio": None,
        "grade": None,
        "effects": {},
        "titleText": None,
        "music": None,
        "summary": [],
    }
    if not text:
        return plan

    if re.search(r"\b(mute|silent|no audio|hide audio|without (audio|sound)|strip audio)\b", lower):
        plan["keepAudio"] = False
        plan["summary"].append("hide audio")
    elif re.search(r"\b(keep audio|with audio|with sound|unmute)\b", lower):
        plan["keepAudio"] = True
        plan["summary"].append("keep audio")

    if re.search(r"\b(warm|golden|sunset|amber)\b", lower):
        plan["grade"] = "warm"
        plan["summary"].append("warm grade")
    elif re.search(r"\b(cool|blue|icy|cold)\b", lower):
        plan["grade"] = "cool"
        plan["summary"].append("cool grade")
    elif re.search(r"\b(vivid|punchy|saturated|pop)\b", lower):
        plan["grade"] = "vivid"
        plan["summary"].append("vivid grade")
    elif re.search(r"\b(noir|bw|b&w|black and white|monochrome|desaturat)\b", lower):
        plan["grade"] = "noir"
        plan["summary"].append("noir grade")
    elif re.search(r"\b(original|reset color|no grade|natural)\b", lower):
        plan["grade"] = "none"
        plan["summary"].append("original color")

    if re.search(r"\bfade\b", lower):
        plan["effects"]["fade"] = True
        plan["summary"].append("fade")
    if re.search(r"\bvignette\b", lower):
        plan["effects"]["vignette"] = True
        plan["summary"].append("vignette")
    if re.search(r"\b(slow[\s-]?mo|slow motion|slower|0\.5x|half speed)\b", lower):
        plan["effects"]["slow"] = True
        plan["summary"].append("slow-mo")
    if re.search(r"\b(normal speed|1x|full speed)\b", lower):
        plan["effects"]["slow"] = False
        plan["summary"].append("normal speed")

    title = (
        re.search(r"\btitle\s*[:=]\s*[\"“']([^\"”']+)[\"”']", text, re.I)
        or re.search(r"\b(?:add|with)\s+title\s+[\"“']([^\"”']+)[\"”']", text, re.I)
        or re.search(r"\btitle\s*[:=]\s*([^,\"”'\n]+)", text, re.I)
    )
    if title and title.group(1):
        plan["effects"]["title"] = True
        plan["titleText"] = title.group(1).strip()[:80]
        plan["summary"].append(f"title “{plan['titleText']}”")
    elif re.search(r"\b(title card|add title|opening title)\b", lower):
        plan["effects"]["title"] = True
        plan["titleText"] = "loading Render Studio"
        plan["summary"].append("title card")

    if re.search(r"\b(cinematic|film look)\b", lower):
        plan["grade"] = plan["grade"] or "warm"
        plan["effects"]["fade"] = True
        plan["effects"]["vignette"] = True
        plan["summary"].append("cinematic")

    if re.search(r"\b(add music|with music|music bed|soundtrack|drop audio)\b", lower):
        plan["music"] = "enable"
        plan["summary"].append("add music")
    elif re.search(r"\b(no music|remove music|without music|mute music)\b", lower):
        plan["music"] = "disable"
        plan["summary"].append("remove music")

    timed = timeline_plan(text)
    for key in ("transition", "zoom", "fadeDuration"):
        if timed.get(key) is not None:
            plan[key] = timed[key]
    for bit in timed.get("summary") or []:
        if bit not in plan["summary"]:
            plan["summary"].append(bit)
    return plan


def _parse_json_object(raw: str) -> dict[str, Any] | None:
    text = str(raw or "").strip()
    if not text:
        return None
    candidates = [text]
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        candidates.append(text[start : end + 1])
    for chunk in candidates:
        try:
            data = json.loads(chunk)
        except Exception:
            continue
        if isinstance(data, dict):
            return data
    return None


def normalize_plan(data: dict[str, Any] | None, fallback_prompt: str = "") -> dict[str, Any]:
    base = local_plan(fallback_prompt)
    timed = timeline_plan(fallback_prompt)
    raw = data if isinstance(data, dict) else {}
    plan: dict[str, Any] = {
        "keepAudio": None,
        "grade": None,
        "effects": {},
        "titleText": None,
        "music": None,
        "transition": None,
        "zoom": None,
        "fadeDuration": None,
        "summary": [],
    }

    if "keepAudio" in raw and raw["keepAudio"] is not None:
        plan["keepAudio"] = bool(raw["keepAudio"])
    elif base["keepAudio"] is not None:
        plan["keepAudio"] = base["keepAudio"]

    grade = str(raw.get("grade") or "").strip().lower()
    if grade in {"original", "natural"}:
        grade = "none"
    if grade in ALLOWED_GRADES:
        plan["grade"] = grade
    elif base["grade"]:
        plan["grade"] = base["grade"]

    effects = raw.get("effects") if isinstance(raw.get("effects"), dict) else {}
    merged_effects = {**(base.get("effects") or {}), **effects}
    plan["effects"] = {
        key: bool(val)
        for key, val in merged_effects.items()
        if val is not None and key in {"fade", "vignette", "slow", "title"}
    }

    title = raw.get("titleText") or raw.get("title") or base.get("titleText")
    if title:
        plan["titleText"] = str(title).strip()[:80]
        plan["effects"]["title"] = True

    music = str(raw.get("music") or base.get("music") or "").strip().lower()
    if music in {"enable", "disable"}:
        plan["music"] = music

    transition = str(raw.get("transition") or timed.get("transition") or "").strip().lower()
    if transition == "crossfade":
        transition = "dissolve"
    if transition in ALLOWED_TRANSITIONS or transition == "dissolve":
        plan["transition"] = transition
    zoom = str(raw.get("zoom") or timed.get("zoom") or "").strip().lower()
    if zoom in {"in", "out", "none"}:
        plan["zoom"] = zoom
    fade_dur = raw.get("fadeDuration")
    if fade_dur is None:
        fade_dur = timed.get("fadeDuration")
    try:
        if fade_dur is not None:
            plan["fadeDuration"] = max(0.1, min(5.0, float(fade_dur)))
    except (TypeError, ValueError):
        pass

    summary = raw.get("summary")
    if isinstance(summary, list) and summary:
        plan["summary"] = [str(item).strip()[:80] for item in summary if str(item).strip()][:8]
    elif base.get("summary"):
        plan["summary"] = list(base["summary"])
    if not plan["summary"]:
        bits = []
        if plan["grade"]:
            bits.append(f"{plan['grade']} grade" if plan["grade"] != "none" else "original color")
        if plan["keepAudio"] is False:
            bits.append("hide audio")
        elif plan["keepAudio"] is True:
            bits.append("keep audio")
        bits.extend(k for k, v in plan["effects"].items() if v)
        if plan["music"]:
            bits.append("add music" if plan["music"] == "enable" else "remove music")
        plan["summary"] = bits
    return plan


def plan_from_model_text(raw: str, prompt: str) -> dict[str, Any]:
    parsed = _parse_json_object(raw)
    if parsed:
        return normalize_plan(parsed, prompt)
    return local_plan(prompt)


def improved_prompt_from_model_text(raw: str, prompt: str) -> tuple[str, dict[str, Any]]:
    parsed = _parse_json_object(raw) or {}
    improved = str(parsed.get("improved_prompt") or parsed.get("prompt") or "").strip()
    if not improved:
        improved = local_improve_prompt(prompt)
    plan = normalize_plan(parsed, prompt)
    timed = timeline_plan(improved)
    for key in ("transition", "zoom", "fadeDuration"):
        if not plan.get(key) and timed.get(key):
            plan[key] = timed[key]
    return improved, plan
