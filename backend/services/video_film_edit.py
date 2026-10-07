"""Assemble a simple film-edit from timeline clips + prompt via ffmpeg.

``/api/video/film-edit`` persists the spec + clips, then
``background_film_edit`` runs in a detached process so uvicorn restart
does not kill the job. Requires ffmpeg on PATH.
"""
from __future__ import annotations

import json
import os
import re
import math
import shutil
import subprocess
from pathlib import Path
from typing import Any, Callable

from backend.services.video_edit_prompt import timeline_plan
from backend.services.video_ffmpeg import ffmpeg_bin, media_container_kind, mp4_audio_args, mp4_codec_args


def _form_float(form: dict[str, Any], key: str, default: float | None = None) -> float | None:
    raw = form.get(key)
    if raw is None or raw == "":
        return default
    try:
        return float(raw)
    except (TypeError, ValueError):
        return default


def normalize_transition(raw: str | None) -> str:
    value = str(raw or "cut").strip().lower()
    if value in {"dissolve", "crossfade", "cross-fade"}:
        return "crossfade"
    if value in {"fade", "fadein", "fade-in"}:
        return "fade"
    return "cut"


def normalize_zoom(raw: str | None) -> str:
    value = str(raw or "none").strip().lower()
    if value in {"in", "zoom-in", "zoomin", "punch"}:
        return "in"
    if value in {"out", "zoom-out", "zoomout"}:
        return "out"
    return "none"


def _media_header(ff: str, src: Path) -> str:
    # Bundled ffmpeg installs do not always include ffprobe.
    proc = subprocess.run([ff, "-hide_banner", "-i", str(src)],
                          capture_output=True, text=True, timeout=15)
    return proc.stderr or ""


def _probe_duration(ff: str, src: Path) -> float:
    sibling = Path(ff).with_name("ffprobe")
    probe_bin = str(sibling) if sibling.is_file() else shutil.which("ffprobe")
    if probe_bin:
        try:
            probe = subprocess.run([probe_bin, "-v", "error", "-show_entries",
                "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(src)],
                capture_output=True, text=True, timeout=15)
            value = float((probe.stdout or "").strip() or "0")
            if math.isfinite(value) and value > 0:
                return value
        except (ValueError, OSError, subprocess.SubprocessError):
            pass
    header = _media_header(ff, src)
    match = re.search(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)", header)
    if match:
        h, m, sec = map(float, match.groups())
        return h * 3600 + m * 60 + sec
    # MediaRecorder WebM often has no duration header. Scan packet timestamps,
    # without decoding/encoding, instead of silently cutting it to one second.
    proc = subprocess.run([ff, "-v", "error", "-i", str(src), "-map", "0:v:0",
        "-c", "copy", "-f", "null", "-", "-progress", "pipe:1"],
        capture_output=True, text=True, timeout=60)
    times = re.findall(r"out_time_us=(\d+)", proc.stdout or "")
    return max((int(t) / 1_000_000 for t in times), default=0.0)


def _zoom_vf(zoom: str) -> str:
    if zoom == "in":
        return (
            "scale=1920:1080:force_original_aspect_ratio=increase,"
            "crop=1920:1080,"
            "zoompan=z='min(zoom+0.0012,1.18)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:fps=30"
        )
    if zoom == "out":
        return (
            "scale=1920:1080:force_original_aspect_ratio=increase,"
            "crop=1920:1080,"
            "zoompan=z='if(eq(on,0),1.18,max(1.0,zoom-0.0012))':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:fps=30"
        )
    return "scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=neighbor,format=yuv420p"


def _container_family(src: Path) -> str:
    kind = media_container_kind(src)
    suffix = src.suffix.lower()
    if kind == "mp4" or suffix in {".mp4", ".mov", ".m4v"}:
        return "mp4"
    if kind == "webm" or suffix in {".webm", ".mkv"}:
        return "webm"
    return kind or "unknown"


def film_edit_needs_video_reencode(
    *,
    zoom: str = "none",
    transition: str = "cut",
    fade_in: list[bool] | None = None,
    fade_out: list[bool] | None = None,
    clip_paths: list[Path] | None = None,
) -> bool:
    """True when we must decode/encode pixels (zoom, fades, images, mixed containers)."""
    if normalize_zoom(zoom) != "none":
        return True
    if normalize_transition(transition) in {"fade", "crossfade"}:
        return True
    if any(bool(flag) for flag in (fade_in or [])):
        return True
    if any(bool(flag) for flag in (fade_out or [])):
        return True
    paths = list(clip_paths or [])
    if any(_is_image_clip(path) for path in paths):
        return True
    families = {_container_family(path) for path in paths}
    if len(families) > 1 or "unknown" in families:
        return True
    return False


def stream_copy_trim_cmd(
    ff: str,
    src: Path,
    dest: Path,
    tin: float,
    use_dur: float,
    mute: bool = False,
) -> list[str]:
    cmd = [ff, "-y"]
    if tin > 0.04:
        cmd += ["-ss", f"{tin:.3f}"]
    cmd += ["-i", str(src)]
    if use_dur > 0:
        cmd += ["-t", f"{use_dur:.3f}"]
    cmd += ["-c", "copy", "-avoid_negative_ts", "make_zero"]
    if mute:
        cmd += ["-an"]
    cmd.append(str(dest))
    return cmd


def _run_ffmpeg(cmd: list[str], dest: Path, timeout: int = 180, cwd: str | None = None) -> bool:
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, cwd=cwd)
    except (OSError, subprocess.SubprocessError):
        return False
    return proc.returncode == 0 and dest.is_file() and dest.stat().st_size > 0


def _mp4_codec_candidates(primary: list[str]) -> list[list[str]]:
    candidates = [list(primary)]
    if "h264_videotoolbox" in primary:
        candidates.append(mp4_codec_args(intent="share", encoder="libx264"))
    return candidates


ProgressCallback = Callable[[int, str], None]


def _emit_progress(on_progress: ProgressCallback | None, pct: int, label: str) -> None:
    if on_progress is None:
        return
    try:
        on_progress(max(0, min(99, int(pct))), str(label or ""))
    except Exception:
        pass


_IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff"}


def _is_image_clip(src: Path) -> bool:
    return src.suffix.lower() in _IMAGE_SUFFIXES


def _src_input_args(src: Path, tin: float) -> list[str]:
    args: list[str] = []
    if _is_image_clip(src):
        args += ["-loop", "1"]
    if tin > 0:
        args += ["-ss", f"{tin:.3f}"]
    args += ["-i", str(src)]
    return args


def _clip_use_duration(
    ff: str,
    src: Path,
    *,
    full_dur: float,
    tin: float,
    tout: float | None,
) -> float:
    duration = float(full_dur or 0.0)
    if duration <= 0:
        duration = _probe_duration(ff, src)
    if tout is not None and tout > tin:
        return max(0.1, float(tout) - tin)
    if duration > tin:
        return max(0.1, duration - tin)
    if _is_image_clip(src):
        return 5.0
    raise RuntimeError("Could not read clip duration. Re-import the source recording.")


def _concat_copy(ff: str, tmp_path: Path, parts: list[Path], assembled: Path) -> bool:
    list_file = tmp_path / "list.txt"
    list_file.write_text("".join(f"file '{p.name}'\n" for p in parts), encoding="utf-8")
    cmd = [ff, "-y", "-f", "concat", "-safe", "0", "-i", str(list_file), "-c", "copy", str(assembled)]
    return _run_ffmpeg(cmd, assembled, timeout=120, cwd=str(tmp_path))


def _mix_music(
    ff: str,
    assembled: Path,
    mixed: Path,
    music_path: Path,
    *,
    music_volume: float,
    music_trim_in: float,
    music_trim_out: float | None,
    music_start_sec: float = 0.0,
) -> Path:
    tin = max(0.0, float(music_trim_in or 0.0))
    tout = float(music_trim_out) if music_trim_out is not None else None
    mix_cmd = [ff, "-y", "-i", str(assembled)]
    if tin > 0.04:
        mix_cmd += ["-ss", f"{tin:.3f}"]
    if tout is not None and tout > tin:
        mix_cmd += ["-t", f"{max(0.1, tout - tin):.3f}"]
    has_audio = bool(re.search(r"Stream .*Audio:", _media_header(ff, assembled)))
    delay_ms = round(max(0.0, float(music_start_sec)) * 1000)
    bed = f"[1:a]volume={music_volume},adelay={delay_ms}:all=1,apad[m]"
    graph = bed + (";[0:a][m]amix=inputs=2:duration=first:normalize=0[a]" if has_audio else "")
    mix_cmd += [
        "-i", str(music_path), "-filter_complex", graph,
        "-map", "0:v:0", "-map", "[a]" if has_audio else "[m]",
        "-c:v", "copy", "-c:a", "libopus" if mixed.suffix == ".webm" else "aac",
        "-shortest", str(mixed),
    ]
    if not _run_ffmpeg(mix_cmd, mixed, timeout=120):
        raise RuntimeError("Could not mix the music track. The original timeline has been kept.")
    return mixed


def run_film_edit(
    tmp_path: Path,
    clip_paths: list[Path],
    *,
    durations: list[float],
    trim_in: list[float],
    trim_out: list[float | None],
    transition: str = "cut",
    fade_duration: float = 0.6,
    zoom: str = "none",
    music_path: Path | None = None,
    music_volume: float = 0.35,
    music_trim_in: float = 0.0,
    music_trim_out: float | None = None,
    music_start_sec: float = 0.0,
    fmt: str = "mp4",
    fade_in: list[bool] | None = None,
    fade_out: list[bool] | None = None,
    mute_clips: list[bool] | None = None,
    on_progress: ProgressCallback | None = None,
) -> Path:
    """Trim/concat clips. Stream-copies when possible; never VP9-reencodes the master."""
    ff = ffmpeg_bin()
    if not clip_paths:
        raise RuntimeError("No usable clips to assemble.")
    transition = normalize_transition(transition)
    zoom = normalize_zoom(zoom)
    fade_duration = max(0.1, min(5.0, float(fade_duration or 0.6)))
    music_volume = max(0.05, min(1.0, float(music_volume or 0.35)))
    want_mp4 = str(fmt).lower() != "webm"
    codec_v = mp4_codec_args(intent="share")
    codec_a = mp4_audio_args()
    use_durs: list[float] = []
    tins: list[float] = []
    mutes: list[bool] = []
    for i, src in enumerate(clip_paths):
        tin = max(0.0, trim_in[i] if i < len(trim_in) else 0.0)
        tout = trim_out[i] if i < len(trim_out) else None
        full_dur = durations[i] if i < len(durations) else 0.0
        use_durs.append(_clip_use_duration(ff, src, full_dur=full_dur, tin=tin, tout=tout))
        tins.append(tin)
        mutes.append(bool(mute_clips[i]) if mute_clips is not None and i < len(mute_clips) else False)

    can_copy = not film_edit_needs_video_reencode(
        zoom=zoom,
        transition=transition,
        fade_in=fade_in,
        fade_out=fade_out,
        clip_paths=clip_paths,
    )
    _emit_progress(on_progress, 22, "Patching clips…")
    if can_copy:
        copies: list[Path] = []
        family = _container_family(clip_paths[0])
        ext = ".webm" if family == "webm" else ".mp4"
        for i, src in enumerate(clip_paths):
            dest = tmp_path / f"copy_{i}{ext}"
            cmd = stream_copy_trim_cmd(ff, src, dest, tins[i], use_durs[i], mutes[i])
            _emit_progress(on_progress, 24 + int(40 * i / max(1, len(clip_paths))), f"Copying clip {i + 1}…")
            if not _run_ffmpeg(cmd, dest, timeout=90):
                copies = []
                break
            copies.append(dest)
        if copies:
            assembled = tmp_path / f"assembled_raw{ext}"
            if len(copies) == 1:
                shutil.copyfile(copies[0], assembled)
            elif not _concat_copy(ff, tmp_path, copies, assembled):
                assembled = Path()
            if assembled.is_file() and assembled.stat().st_size > 0:
                mixed = assembled
                if music_path and music_path.is_file():
                    _emit_progress(on_progress, 78, "Mixing audio…")
                    mixed = _mix_music(
                        ff,
                        assembled,
                        tmp_path / f"assembled_music{ext}",
                        music_path,
                        music_volume=music_volume,
                        music_trim_in=music_trim_in,
                        music_trim_out=music_trim_out,
                        music_start_sec=music_start_sec,
                    )
                _emit_progress(on_progress, 92, "Film edit ready")
                return mixed

    norms: list[Path] = []
    for i, src in enumerate(clip_paths):
        use_dur = use_durs[i]
        tin = tins[i]
        fd = min(fade_duration, max(0.1, use_dur / 3))
        vf_parts = [_zoom_vf(zoom)]
        af_parts: list[str] = []
        global_fade = transition in {"fade", "crossfade"}
        want_in = bool(fade_in[i]) if fade_in is not None and i < len(fade_in) else global_fade
        want_out = bool(fade_out[i]) if fade_out is not None and i < len(fade_out) else global_fade
        if want_in:
            vf_parts.append(f"fade=t=in:st=0:d={fd}")
            af_parts.append(f"afade=t=in:st=0:d={fd}")
        if want_out and use_dur > fd * 2:
            vf_parts.append(f"fade=t=out:st={max(0.0, use_dur - fd)}:d={fd}")
            af_parts.append(f"afade=t=out:st={max(0.0, use_dur - fd)}:d={fd}")
        if mutes[i]:
            af_parts.append("volume=0")
        _emit_progress(on_progress, 24 + int(50 * i / max(1, len(clip_paths))), f"Encoding clip {i + 1}…")
        norm = tmp_path / f"norm_{i}.mp4"
        encoded_with: list[str] | None = None
        for candidate in _mp4_codec_candidates(codec_v):
            cmd = [ff, "-y", *_src_input_args(src, tin)]
            if use_dur > 0:
                cmd += ["-t", f"{use_dur:.3f}"]
            cmd += ["-vf", ",".join(vf_parts)]
            if af_parts:
                cmd += ["-af", ",".join(af_parts)]
            cmd += [*candidate, *codec_a, str(norm)]
            if _run_ffmpeg(cmd, norm, timeout=180):
                encoded_with = candidate
                break
            silent_cmd = [ff, "-y", *_src_input_args(src, tin)]
            if use_dur > 0:
                silent_cmd += ["-t", f"{use_dur:.3f}"]
            silent_cmd += ["-vf", ",".join(vf_parts), "-an", *candidate, str(norm)]
            if _run_ffmpeg(silent_cmd, norm, timeout=180):
                encoded_with = candidate
                break
        if encoded_with is None:
            raise RuntimeError(f"Could not normalize clip {i + 1}.")
        codec_v = encoded_with
        norms.append(norm)

    assembled = tmp_path / "assembled_raw.mp4"
    _emit_progress(on_progress, 76, "Assembling timeline…")
    if transition == "crossfade" and len(norms) >= 2:
        inputs: list[str] = []
        for p in norms:
            inputs += ["-i", str(p)]
        filter_parts: list[str] = []
        cur = "[0:v]"
        cura = "[0:a]"
        offset = max(0.0, use_durs[0] - fade_duration)
        for i in range(1, len(norms)):
            out_v = f"[v{i}]" if i < len(norms) - 1 else "[vout]"
            out_a = f"[a{i}]" if i < len(norms) - 1 else "[aout]"
            filter_parts.append(
                f"{cur}[{i}:v]xfade=transition=fade:duration={fade_duration}:offset={offset:.3f}{out_v}"
            )
            filter_parts.append(f"{cura}[{i}:a]acrossfade=d={fade_duration}{out_a}")
            cur = out_v
            cura = out_a
            if i < len(norms) - 1:
                offset = max(0.0, offset + use_durs[i] - fade_duration)
        cmd = [
            ff, "-y", *inputs,
            "-filter_complex", ";".join(filter_parts),
            "-map", "[vout]", "-map", "[aout]",
            *codec_v, *codec_a,
            str(assembled),
        ]
        if not _run_ffmpeg(cmd, assembled, timeout=240):
            transition = "cut"

    if transition != "crossfade" or not assembled.is_file():
        if not _concat_copy(ff, tmp_path, norms, assembled):
            list_file = tmp_path / "list.txt"
            cmd2 = [
                ff, "-y", "-f", "concat", "-safe", "0", "-i", str(list_file),
                *codec_v, *codec_a, str(assembled),
            ]
            if not _run_ffmpeg(cmd2, assembled, timeout=240, cwd=str(tmp_path)):
                raise RuntimeError("Could not assemble clips.")

    mixed = assembled
    if music_path and music_path.is_file():
        _emit_progress(on_progress, 88, "Mixing audio…")
        mixed = _mix_music(
            ff,
            assembled,
            tmp_path / "assembled_music.mp4",
            music_path,
            music_volume=music_volume,
            music_trim_in=music_trim_in,
            music_trim_out=music_trim_out,
            music_start_sec=music_start_sec,
        )
    _emit_progress(on_progress, 94, "Film edit ready")
    if want_mp4 and mixed.suffix.lower() == ".mp4":
        return mixed
    return mixed


def plan_from_prompt(prompt: str) -> dict[str, Any]:
    return timeline_plan(prompt)


def dumps_plan(plan: dict[str, Any]) -> str:
    return json.dumps(plan)


FILM_EDIT_KIND = "video"
FILM_EDIT_SPEC_NAME = "film-edit.json"


def film_edit_job_dir(project_path: Path, trace_id: str) -> Path:
    return Path(project_path) / ".generation_jobs" / f"{str(trace_id).strip()}-film"


def provider_from_key_source(source: str | None, model: str | None = None) -> str:
    token = str(source or "").strip().lower()
    raw = str(model or "").strip().lower()
    if token in {"chatgpt", "subscription", "openai"}:
        return "openai"
    if token == "claude":
        return "anthropic"
    if token == "cursor":
        return "cursor"
    if "claude" in raw or "fable" in raw or "opus" in raw or "sonnet" in raw:
        return "anthropic"
    if token:
        return token
    return "openai"


def persist_film_edit_job(
    project_path: Path,
    trace_id: str,
    spec: dict[str, Any],
) -> Path:
    dest = film_edit_job_dir(project_path, trace_id)
    dest.mkdir(parents=True, exist_ok=True)
    payload = dict(spec or {})
    payload.pop("_on_progress", None)
    payload["trace_id"] = str(trace_id)
    payload["project_path"] = str(project_path)
    (dest / FILM_EDIT_SPEC_NAME).write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return dest


def load_film_edit_spec(project_path: Path, trace_id: str) -> dict[str, Any]:
    path = film_edit_job_dir(project_path, trace_id) / FILM_EDIT_SPEC_NAME
    if not path.is_file():
        raise FileNotFoundError(f"Film-edit job {trace_id} is gone.")
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise RuntimeError("Film-edit job spec is invalid.")
    return data


def write_job_bytes(job_dir: Path, name: str, data: bytes) -> str:
    safe = Path(str(name or "clip.bin")).name or "clip.bin"
    dest = Path(job_dir) / safe
    dest.write_bytes(data)
    return dest.name


def _resolve_clip_src(project_path: Path, job_dir: Path, row: dict[str, Any]) -> Path | None:
    from backend.services import cad_service

    file_name = str(row.get("file") or "").strip()
    if file_name:
        local = job_dir / Path(file_name).name
        if local.is_file():
            return local
    path_ref = str(row.get("path_ref") or "").strip()
    if path_ref:
        resolved = cad_service.resolve_project_file(project_path, path_ref)
        if resolved is None and not path_ref.startswith("references/"):
            resolved = cad_service.resolve_project_file(project_path, f"references/{path_ref}")
        if resolved is not None and resolved.is_file():
            return resolved
    return None


def run_persisted_film_edit(project_path: Path, spec: dict[str, Any]) -> Path:
    from backend.services import cad_service

    trace_id = str(spec.get("trace_id") or "film")
    job_dir = film_edit_job_dir(project_path, trace_id)
    work = job_dir / "work"
    work.mkdir(parents=True, exist_ok=True)
    rows = spec.get("clips") if isinstance(spec.get("clips"), list) else []
    paths: list[Path] = []
    trim_in: list[float] = []
    trim_out: list[float | None] = []
    fade_in: list[bool] = []
    fade_out: list[bool] = []
    mute_clips: list[bool] = []
    durations: list[float] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        src = _resolve_clip_src(project_path, job_dir, row)
        if src is None:
            continue
        paths.append(src)
        durations.append(float(row.get("duration") or 0.0))
        trim_in.append(float(row.get("trim_in") or 0.0))
        raw_out = row.get("trim_out")
        trim_out.append(float(raw_out) if raw_out not in (None, "") else None)
        fade_in.append(bool(row.get("fade_in")))
        fade_out.append(bool(row.get("fade_out")))
        mute_clips.append(bool(row.get("mute")))
    if not paths:
        raise RuntimeError("No usable clips to assemble.")
    music_path = None
    music = spec.get("music") if isinstance(spec.get("music"), dict) else None
    if music and music.get("file"):
        candidate = job_dir / Path(str(music.get("file"))).name
        if candidate.is_file():
            music_path = candidate
    fmt = "mp4" if str(spec.get("fmt") or "mp4").lower() != "webm" else "webm"
    on_progress = spec.get("_on_progress") if callable(spec.get("_on_progress")) else None
    assembled = run_film_edit(
        work,
        paths,
        durations=durations,
        trim_in=trim_in,
        trim_out=trim_out,
        transition=str(spec.get("transition") or "cut"),
        fade_duration=float(spec.get("fade_duration") or 0.6),
        zoom=str(spec.get("zoom") or "none"),
        music_path=music_path,
        music_volume=float((music or {}).get("volume") or spec.get("music_volume") or 0.35),
        music_trim_in=float((music or {}).get("trim_in") or spec.get("music_trim_in") or 0.0),
        music_trim_out=(
            float(music.get("trim_out"))
            if music and music.get("trim_out") not in (None, "")
            else None
        ),
        music_start_sec=float((music or {}).get("start_sec") or 0.0),
        fmt=fmt,
        fade_in=fade_in,
        fade_out=fade_out,
        mute_clips=mute_clips,
        on_progress=on_progress,
    )
    suffix = assembled.suffix.lower().lstrip(".") or fmt
    dest = cad_service.unique_reference_path(
        project_path,
        f"render3d-edit-{trace_id[:10]}.{suffix}",
        folder=cad_service.REFERENCE_VIDEO_EDITOR_DIRNAME,
    )
    shutil.copyfile(assembled, dest)
    return dest


def background_film_edit(
    project_id: str,
    project_path_str: str,
    trace_id: str,
    user: dict[str, Any] | None = None,
) -> None:
    """Detached worker: assemble persisted clips and mark generation.json complete."""
    from backend.services import generation_service

    project_path = Path(project_path_str)
    tid = str(trace_id or "").strip()
    try:
        generation_service.set_worker_pid(project_path, os.getpid(), trace_id=tid, detached=True)
    except Exception:
        pass
    try:
        if generation_service.is_canceled(project_path, tid):
            return
        spec = load_film_edit_spec(project_path, tid)
        model = str(spec.get("model") or "")
        label = f"Generating with {model}" if model else "Assembling film edit…"
        generation_service.update_progress(
            project_path,
            {"stage": "film-edit", "pct": 18, "label": label},
            trace_id=tid,
        )

        def _progress(pct: int, text: str) -> None:
            generation_service.update_progress(
                project_path,
                {"stage": "film-edit", "pct": pct, "label": text or label},
                trace_id=tid,
            )

        spec["_on_progress"] = _progress
        dest = run_persisted_film_edit(project_path, spec)
        if generation_service.is_canceled(project_path, tid):
            return
        from urllib.parse import quote

        try:
            rel = dest.relative_to(project_path).as_posix()
        except ValueError:
            rel = dest.name
        generation_service.complete(
            project_path,
            {
                "filename": rel,
                "url": f"/api/projects/{quote(project_id, safe='')}/files/{quote(rel, safe='/')}",
                "path": rel,
                "model": spec.get("model"),
                "provider": spec.get("provider"),
                "kind": FILM_EDIT_KIND,
                "editor_name": spec.get("editor_name"),
                "duration": _probe_duration(ffmpeg_bin(), dest),
                "label": "Film edit ready",
            },
            trace_id=tid,
        )
    except Exception as exc:
        try:
            generation_service.fail(
                project_path,
                str(exc) or "Film edit failed.",
                trace_id=tid,
                extra={"kind": FILM_EDIT_KIND},
            )
        except Exception:
            pass
        raise
