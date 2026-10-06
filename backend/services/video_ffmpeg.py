"""Resolve an ffmpeg binary for clip convert / X encode."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from functools import lru_cache
from pathlib import Path
from typing import Any

# X rejects clips above 60 fps. Chrome MediaRecorder WebM uses a 1 ms timescale
# that ffmpeg/X often report as 1000 fps unless we CFR-resample on encode.
X_MAX_FPS = 60

# Cap the long edge at 1080p for X / share downloads: sharp on a phone or
# desktop timeline, much faster to encode and download than native 4K canvas.
X_SCALE_VF = (
    r"scale=if(gt(iw\,ih)\,1920\,-2):if(gte(ih\,iw)\,1920\,-2):flags=bicubic,"
    r"scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=neighbor,"
    r"format=yuv420p,setsar=1"
)
EVEN_SCALE_VF = r"scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=bicubic,format=yuv420p,setsar=1"

# Download GIFs: even dims, never 0/1px, full palette (diff mode can collapse
# a short/static clip to a 1×N orange/white strip).
GIF_VF = (
    "fps=12,"
    r"scale=min(720\,iw):-2:flags=lanczos,"
    r"scale=max(2\,iw):max(ih\,2):flags=neighbor,"
    r"scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=neighbor,"
    "format=rgb24,"
    "split[s0][s1];[s0]palettegen=stats_mode=full[p];"
    "[s1][p]paletteuse=dither=bayer:bayer_scale=5"
)
GIF_MAX_SEC = 15
VIDEO_EXPORT_FORMATS = ("mp4", "webm", "gif")
VIDEO_EXPORT_MEDIA = {
    "mp4": "video/mp4",
    "webm": "video/webm",
    "gif": "image/gif",
}


class VideoExportError(Exception):
    """Clip export failed; `status` maps to an HTTP code in the share/convert routes."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = int(status or 400)


@lru_cache(maxsize=1)
def ffmpeg_bin() -> str:
    found = shutil.which("ffmpeg")
    if found:
        return found
    root = Path(__file__).resolve().parents[2]
    candidates = (
        root / ".venv" / "bin" / "ffmpeg",
        root / ".venv-mac" / "bin" / "ffmpeg",
        Path("/opt/homebrew/bin/ffmpeg"),
        Path("/usr/local/bin/ffmpeg"),
        Path("/usr/bin/ffmpeg"),
    )
    for path in candidates:
        try:
            if path.is_file() and os.access(path, os.X_OK):
                return str(path)
        except OSError:
            continue
    return "ffmpeg"


def clamp_x_fps(fps: int | float | None = None) -> int:
    try:
        value = int(fps) if fps is not None else X_MAX_FPS
    except (TypeError, ValueError):
        value = X_MAX_FPS
    return max(1, min(value, X_MAX_FPS))


def cap_fps_vf(chain: str, fps: int | float | None = None) -> str:
    """Prefix a filtergraph with CFR fps so X does not see a 1000 fps timescale."""
    rate = clamp_x_fps(fps)
    body = str(chain or "").strip().lstrip(",")
    return f"fps={rate},{body}" if body else f"fps={rate}"


def x_h264_vf(fps: int | float | None = None) -> str:
    return cap_fps_vf(X_SCALE_VF, fps)


def even_h264_vf(fps: int | float | None = None) -> str:
    return cap_fps_vf(EVEN_SCALE_VF, fps)


def mp4_scale_vf(intent: str | None = None, fps: int | float | None = None) -> str:
    """Social/share MP4s cap at 1920; keep even-dimension fallback for other uses."""
    kind = str(intent or "share").strip().lower()
    if kind in {"full", "source", "raw"}:
        return even_h264_vf(fps)
    return x_h264_vf(fps)


def x_output_rate_args(fps: int | float | None = None) -> list[str]:
    """Output muxer rate. Must come after `-i` so it does not change input decode."""
    return ["-r", str(clamp_x_fps(fps))]


@lru_cache(maxsize=1)
def h264_encoder() -> str:
    """Prefer Mac VideoToolbox when ffmpeg has it; otherwise libx264."""
    ff = ffmpeg_bin()
    try:
        proc = subprocess.run(
            [ff, "-hide_banner", "-encoders"],
            capture_output=True,
            text=True,
            timeout=8,
        )
        text = f"{proc.stdout or ''}\n{proc.stderr or ''}"
        if "h264_videotoolbox" in text:
            return "h264_videotoolbox"
    except (OSError, subprocess.SubprocessError):
        pass
    return "libx264"


def normalize_export_quality(quality: str | None = None) -> str:
    q = str(quality or "").strip().lower()
    return q if q in {"standard", "high", "ultra"} else ""


def mp4_software_codec_args(intent: str | None = None, quality: str | None = None) -> list[str]:
    """Fast high-quality software H.264. veryfast + CRF 18/19 looks sharp on X."""
    kind = str(intent or "share").strip().lower()
    q = normalize_export_quality(quality)
    if q == "standard":
        crf = "23"
    elif q == "ultra":
        crf = "17"
    elif q == "high":
        crf = "19" if kind == "x" else "18"
    else:
        crf = "19" if kind == "x" else "18"
    return [
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-profile:v", "high",
        "-preset", "veryfast",
        "-crf", crf,
        "-movflags", "+faststart",
    ]


def mp4_videotoolbox_codec_args(intent: str | None = None, quality: str | None = None) -> list[str]:
    kind = str(intent or "share").strip().lower()
    q = normalize_export_quality(quality)
    # Hardware encode is near real-time; 10–12 Mbps is X-ready 1080p60.
    if q == "standard":
        br = "6M"
    elif q == "ultra":
        br = "16M"
    else:
        br = "10M" if kind == "x" else "12M"
    return [
        "-c:v", "h264_videotoolbox",
        "-b:v", br,
        "-maxrate", "16M",
        "-bufsize", "24M",
        "-profile:v", "high",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
    ]


def mp4_codec_args(intent: str | None = None, encoder: str | None = None, quality: str | None = None) -> list[str]:
    chosen = encoder or h264_encoder()
    if chosen == "h264_videotoolbox":
        return mp4_videotoolbox_codec_args(intent, quality)
    return mp4_software_codec_args(intent, quality)


def webm_crf_for_quality(quality: str | None = None) -> str:
    q = normalize_export_quality(quality)
    if q == "standard":
        return "36"
    if q == "ultra":
        return "28"
    return "32"


def mp4_audio_args() -> list[str]:
    return ["-c:a", "aac", "-b:a", "160k"]


def parse_audio_flag(value: Any, default: bool = True) -> bool:
    """Interpret share/convert audio query or form values. Default keeps soundtrack."""
    if value is None:
        return bool(default)
    if isinstance(value, bool):
        return value
    raw = str(value).strip().lower()
    if raw in {"", "1", "true", "yes", "on", "audio", "with", "with-audio", "with_audio"}:
        return True
    if raw in {"0", "false", "no", "off", "mute", "silent", "none", "an", "without", "without-audio", "without_audio"}:
        return False
    return bool(default)


def parse_audio_start(value: Any, default: float = 0.0) -> float:
    """Seconds into an overlay song. Invalid values become `default`."""
    try:
        start = float(value)
    except (TypeError, ValueError):
        return default
    if start != start or start < 0:
        return default
    return start


def build_trim_copy_cmd(
    src: Path | str,
    out: Path | str,
    *,
    trim_in: float = 0.0,
    duration: float | None = None,
    ff: str | None = None,
) -> list[str]:
    """Stream-copy a clip window. Fast path for Share to X in/out handles."""
    cmd = [ff or ffmpeg_bin(), "-y"]
    start = max(0.0, float(trim_in or 0))
    if start > 0.001:
        cmd.extend(["-ss", f"{start:.3f}"])
    cmd.extend(["-i", str(src)])
    try:
        dur = float(duration) if duration is not None and float(duration) > 0 else None
    except (TypeError, ValueError):
        dur = None
    if dur:
        cmd.extend(["-t", f"{dur:.3f}"])
    cmd.extend(["-c", "copy", "-avoid_negative_ts", "make_zero"])
    if str(out).lower().endswith(".mp4"):
        cmd.extend(["-movflags", "+faststart"])
    cmd.append(str(out))
    return cmd


def apply_ffmpeg_trim(cmd: list[str], trim_in: float = 0.0, duration: float | None = None) -> list[str]:
    """Insert -ss before -i and -t before the output path."""
    out = list(cmd or [])
    if not out:
        return out
    start = max(0.0, float(trim_in or 0))
    if start > 0.001:
        try:
            i = out.index("-i")
            out[i:i] = ["-ss", f"{start:.3f}"]
        except ValueError:
            pass
    try:
        dur = float(duration) if duration is not None and float(duration) > 0 else None
    except (TypeError, ValueError):
        dur = None
    if dur:
        if "-t" in out:
            t_i = out.index("-t")
            if t_i + 1 < len(out):
                out[t_i + 1] = f"{dur:.3f}"
        else:
            out[-1:-1] = ["-t", f"{dur:.3f}"]
    return out


def build_mux_audio_cmd(
    video: Path | str,
    audio: Path | str,
    out: Path | str,
    *,
    audio_start: float = 0.0,
    duration: float | None = None,
    ff: str | None = None,
    fmt: str = "mp4",
) -> list[str]:
    """Copy the video stream; trim overlay audio from `audio_start` to `duration`."""
    start = max(0.0, float(audio_start or 0))
    try:
        dur = float(duration) if duration is not None and float(duration) > 0 else None
    except (TypeError, ValueError):
        dur = None
    cmd = [
        ff or ffmpeg_bin(),
        "-y",
        "-i", str(video),
        "-ss", f"{start:.3f}",
        "-i", str(audio),
        "-map", "0:v:0",
        "-map", "1:a:0",
        "-c:v", "copy",
    ]
    if str(fmt or "mp4").strip().lower() == "webm":
        cmd.extend(["-c:a", "libopus", "-b:a", "160k"])
    else:
        cmd.extend([*mp4_audio_args(), "-movflags", "+faststart"])
    if dur:
        cmd.extend(["-t", f"{dur:.3f}"])
    else:
        cmd.append("-shortest")
    cmd.append(str(out))
    return cmd


def build_webm_cmd(
    src: Path | str,
    out: Path | str,
    *,
    with_audio: bool = True,
    ff: str | None = None,
    quality: str | None = None,
) -> list[str]:
    cmd = [
        ff or ffmpeg_bin(),
        "-y",
        "-i",
        str(src),
        "-c:v",
        "libvpx-vp9",
        "-b:v",
        "0",
        "-crf",
        webm_crf_for_quality(quality),
    ]
    if with_audio:
        cmd.extend(["-c:a", "libopus"])
    else:
        cmd.append("-an")
    cmd.append(str(out))
    return cmd


def build_strip_audio_cmd(
    src: Path | str,
    out: Path | str,
    *,
    ff: str | None = None,
) -> list[str]:
    """Keep the video bitstream; drop audio. Fast path for mute downloads."""
    cmd = [
        ff or ffmpeg_bin(),
        "-y",
        "-i",
        str(src),
        "-map",
        "0:v:0",
        "-c:v",
        "copy",
        "-an",
    ]
    if str(out).lower().endswith(".mp4"):
        cmd.extend(["-movflags", "+faststart"])
    cmd.append(str(out))
    return cmd


def share_video_download_name(
    src: Path | str,
    fmt: str,
    *,
    with_audio: bool,
    with_markup: bool = False,
) -> str:
    stem = Path(src).stem or "render3d-video"
    ext = str(fmt or "mp4").strip().lower() or "mp4"
    marked = "-marked" if with_markup else ""
    if ext == "gif" or with_audio:
        return f"{stem}{marked}.{ext}"
    return f"{stem}{marked}-silent.{ext}"


def read_media_magic(src: Path | str, nbytes: int = 48) -> bytes:
    path = Path(src)
    try:
        with path.open("rb") as handle:
            return handle.read(max(12, nbytes))
    except OSError:
        return b""


def media_container_kind(src: Path | str, head: bytes | None = None) -> str:
    data = head if head is not None else read_media_magic(src)
    if data.startswith(b"GIF87a") or data.startswith(b"GIF89a"):
        return "gif"
    if data.startswith(b"\x1a\x45\xdf\xa3"):
        return "webm"
    if len(data) >= 8 and data[4:8] == b"ftyp":
        return "mp4"
    return "unknown"


def mp4_ftyp_has_avc1(head: bytes) -> bool:
    if len(head) < 12 or head[4:8] != b"ftyp":
        return False
    return b"avc1" in head[8:] or b"avc3" in head[8:]


def probe_media_duration(src: Path | str) -> float:
    cmd = [
        ffprobe_bin(),
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "json",
        str(src),
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
        payload = json.loads(proc.stdout or "{}")
        return max(0.4, float((payload.get("format") or {}).get("duration") or 0))
    except (OSError, subprocess.SubprocessError, ValueError, json.JSONDecodeError, TypeError):
        return 0.0


def ffprobe_bin(ff: str | None = None) -> str:
    ffmpeg = ff or ffmpeg_bin()
    sibling = str(Path(ffmpeg).with_name("ffprobe"))
    if sibling != "ffprobe" and Path(sibling).is_file():
        return sibling
    return shutil.which("ffprobe") or "ffprobe"


def probe_share_codecs(src: Path | str) -> dict[str, str]:
    cmd = [
        ffprobe_bin(),
        "-v", "error",
        "-show_entries", "stream=codec_type,codec_name",
        "-of", "json",
        str(src),
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.SubprocessError):
        return {}
    if proc.returncode != 0:
        return {}
    try:
        payload = json.loads(proc.stdout or "{}")
    except json.JSONDecodeError:
        return {}
    video = ""
    audio = ""
    for stream in payload.get("streams") or []:
        kind = str(stream.get("codec_type") or "").lower()
        name = str(stream.get("codec_name") or "").lower()
        if kind == "video" and not video:
            video = name
        elif kind == "audio" and not audio:
            audio = name
    return {"video": video, "audio": audio}


def is_windows_friendly_mp4(src: Path | str) -> bool:
    """True only for ISO BMFF with H.264 (avc1) — what Windows/QuickTime will open."""
    path = Path(src)
    if not path.is_file():
        return False
    head = read_media_magic(path)
    if media_container_kind(path, head) != "mp4":
        return False
    codecs = probe_share_codecs(path)
    video = codecs.get("video") or ""
    audio = codecs.get("audio") or ""
    if video:
        if video not in {"h264", "avc1", "avc3"}:
            return False
        if audio and audio not in {"aac", "mp4a", "mp3"}:
            return False
        return True
    return mp4_ftyp_has_avc1(head)


def can_passthrough_share_video(src: Path | str, fmt: str, *, with_audio: bool) -> bool:
    path = Path(src)
    fmt = str(fmt or "mp4").strip().lower()
    if fmt == "gif":
        return path.suffix.lower() == ".gif" and media_container_kind(path) == "gif"
    if not with_audio:
        return False
    if fmt == "mp4":
        return is_windows_friendly_mp4(path)
    if fmt == "webm":
        return media_container_kind(path) == "webm"
    return False


def build_overlay_filter(overlay_count: int) -> str:
    if overlay_count <= 0:
        return ""
    last = "0:v"
    parts: list[str] = []
    for index in range(overlay_count):
        nxt = f"v{index + 1}"
        start = f"start{index}"
        end = f"end{index}"
        parts.append(
            f"[{last}][{index + 1}:v]overlay=0:0:enable='between(t,{start},{end})':format=auto[{nxt}]"
        )
        last = nxt
    return ";".join(parts)


def export_clip_bytes(
    src: Path | str,
    fmt: str,
    *,
    with_audio: bool = True,
    quality: str | None = None,
    overlays: list[dict[str, Any]] | None = None,
) -> tuple[bytes, str, str]:
    """Transcode `src` with the existing mp4/webm/gif ffmpeg stack.

    Returns (bytes, media_type, download_name). Callers that can stream the
    original file should use `can_passthrough_share_video` and skip this.
    """
    fmt = str(fmt or "mp4").strip().lower()
    if fmt not in VIDEO_EXPORT_FORMATS:
        raise VideoExportError("format must be mp4, webm, or gif.")
    src_path = Path(src)
    if not src_path.is_file():
        raise VideoExportError("Shared video file was not found.", 404)
    keep_audio = bool(with_audio) and fmt != "gif"
    raw_overlays = list(overlays or [])
    has_markup = bool(raw_overlays)
    media_type = VIDEO_EXPORT_MEDIA[fmt]
    download_name = share_video_download_name(
        src_path,
        fmt,
        with_audio=keep_audio,
        with_markup=has_markup,
    )
    if not has_markup and can_passthrough_share_video(src_path, fmt, with_audio=keep_audio):
        return src_path.read_bytes(), media_type, download_name

    ff = ffmpeg_bin()
    timeout = 180 if has_markup else (90 if fmt == "mp4" else 180)
    with tempfile.TemporaryDirectory(prefix="r3d-share-vid-") as tmp:
        out = Path(tmp) / f"output.{fmt}"
        overlay_jobs: list[dict[str, Any]] = []
        for index, job in enumerate(raw_overlays):
            path = job.get("path")
            if not path and job.get("image") is not None:
                path = Path(tmp) / f"overlay-{index}.png"
                job["image"].save(path, "PNG")
            if path:
                overlay_jobs.append({**job, "path": str(path)})
        cmds: list[list[str]] = []
        if overlay_jobs:
            cmds.append(build_overlay_export_cmd(
                src_path,
                out,
                overlay_jobs,
                fmt=fmt,
                with_audio=keep_audio,
                ff=ff,
                quality=quality,
            ))
        elif fmt == "mp4" and not keep_audio:
            if is_windows_friendly_mp4(src_path):
                cmds.append(build_strip_audio_cmd(src_path, out, ff=ff))
            cmds.append(build_mp4_cmd(src_path, out, intent="share", encoder="libx264", with_audio=False, ff=ff, quality=quality))
        elif fmt == "mp4":
            encoder = h264_encoder()
            cmds.append(build_mp4_cmd(src_path, out, intent="share", encoder=encoder, with_audio=True, ff=ff, quality=quality))
            if encoder == "h264_videotoolbox":
                cmds.append(build_mp4_cmd(src_path, out, intent="share", encoder="libx264", with_audio=True, ff=ff, quality=quality))
            cmds.append(build_mp4_cmd(src_path, out, intent="share", encoder="libx264", with_audio=False, ff=ff, quality=quality))
        elif fmt == "webm":
            cmds.append(build_webm_cmd(src_path, out, with_audio=keep_audio, ff=ff, quality=quality))
            if keep_audio:
                cmds.append(build_webm_cmd(src_path, out, with_audio=False, ff=ff, quality=quality))
        else:
            cmds.append(build_gif_cmd(src_path, out, ff=ff))

        last_err = ""
        for cmd in cmds:
            try:
                proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
            except FileNotFoundError as exc:
                raise VideoExportError("ffmpeg is required for clip conversion.", 503) from exc
            except subprocess.TimeoutExpired as exc:
                raise VideoExportError("Video conversion timed out.", 504) from exc
            if proc.returncode == 0 and out.is_file() and out.stat().st_size > 0:
                return out.read_bytes(), media_type, download_name
            last_err = (proc.stderr or proc.stdout or "")[-400:]
        detail = f"Could not convert clip to {fmt.upper()}."
        if last_err:
            detail = f"{detail} {last_err}".strip()
        raise VideoExportError(detail)


def build_overlay_export_cmd(
    src: Path | str,
    out: Path | str,
    overlays: list[dict[str, Any]],
    *,
    fmt: str = "mp4",
    with_audio: bool = True,
    ff: str | None = None,
    quality: str | None = None,
) -> list[str]:
    jobs = [job for job in overlays if job.get("path")]
    hold = probe_media_duration(src) or max((float(job.get("end") or 0) for job in jobs), default=4.0)
    hold = max(1.0, min(hold, 600.0))
    cmd = [ff or ffmpeg_bin(), "-y", "-fflags", "+genpts", "-i", str(src)]
    for job in jobs:
        cmd.extend(["-loop", "1", "-t", f"{hold:.3f}", "-i", str(job["path"])])
    last = "0:v"
    parts: list[str] = []
    for index, job in enumerate(jobs):
        nxt = f"v{index + 1}"
        start = max(0.0, float(job.get("start") or 0))
        end = max(start + 0.4, float(job.get("end") or start + 3.2))
        parts.append(
            f"[{last}][{index + 1}:v]overlay=0:0:enable='between(t,{start:.3f},{end:.3f})':format=auto[{nxt}]"
        )
        last = nxt
    scale = mp4_scale_vf("share")
    if fmt == "gif":
        vf = f"{';'.join(parts)};[{last}]{GIF_VF}[vout]" if parts else f"[0:v]{GIF_VF}[vout]"
        cmd.extend(["-filter_complex", vf, "-map", "[vout]", "-an", "-t", str(GIF_MAX_SEC), "-loop", "0", str(out)])
        return cmd
    vf = f"{';'.join(parts)};[{last}]{scale}[vout]" if parts else f"[0:v]{scale}[vout]"
    cmd.extend(["-filter_complex", vf, "-map", "[vout]"])
    if fmt == "webm":
        cmd.extend(["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", webm_crf_for_quality(quality)])
        if with_audio:
            cmd.extend(["-map", "0:a?", "-c:a", "libopus"])
        else:
            cmd.append("-an")
        cmd.extend(["-shortest", str(out)])
        return cmd
    cmd.extend(mp4_codec_args("share", "libx264", quality))
    if with_audio:
        mov = cmd.index("-movflags")
        cmd[mov:mov] = ["-map", "0:a?", *mp4_audio_args()]
    else:
        mov = cmd.index("-movflags")
        cmd[mov:mov] = ["-an"]
    cmd.extend(["-shortest", str(out)])
    return cmd


def build_mp4_cmd(
    src: Path | str,
    out: Path | str,
    *,
    intent: str | None = "share",
    encoder: str | None = None,
    with_audio: bool = True,
    ff: str | None = None,
    quality: str | None = None,
) -> list[str]:
    cmd = [
        ff or ffmpeg_bin(),
        "-y",
        "-fflags", "+genpts",
        "-i", str(src),
        "-vf", mp4_scale_vf(intent),
        *x_output_rate_args(),
        *mp4_codec_args(intent, encoder, quality),
    ]
    if with_audio:
        # Insert audio args before -movflags so the silent retry can drop them.
        mov = cmd.index("-movflags")
        cmd[mov:mov] = mp4_audio_args()
    else:
        mov = cmd.index("-movflags")
        cmd[mov:mov] = ["-an"]
    cmd.append(str(out))
    return cmd


def gif_vf() -> str:
    return GIF_VF


def build_gif_cmd(
    src: Path | str,
    out: Path | str,
    *,
    ff: str | None = None,
    max_sec: int | float | None = None,
) -> list[str]:
    """Palette GIF with even, non-zero dimensions. Caps duration so 0-fps clips don't hang."""
    cap = GIF_MAX_SEC if max_sec is None else max(1, int(max_sec))
    return [
        ff or ffmpeg_bin(),
        "-y",
        "-fflags", "+genpts",
        "-i", str(src),
        "-t", str(cap),
        "-an",
        "-vf", gif_vf(),
        "-loop", "0",
        str(out),
    ]
