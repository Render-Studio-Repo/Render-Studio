# Video edit playback and media fixes — 2026-09-16

Recent project 2ee4d857 film jobs completed in roughly 1–2 seconds. The apparent stall included several distinct failures:

- Completed private file URLs were assigned directly to the video element without authentication. The later authenticated download did not replace the player source.
- The bundled ffmpeg had no sibling ffprobe. Duration lookup returned zero and the fallback trimmed each source to one second. Existing two follow-up outputs measured 1.02 seconds.
- Music used AAC inside WebM, which fails; a silent source also failed the assumed source-audio mapping. Both failures returned the original video as successful.
- Resume selected the oldest completed video job, and polling could substitute another job or overlap slow requests.

Changes: one authenticated result download shared by timeline playback and exports; exact job matching, latest completed resume and non-overlapping polls; duration fallback through ffmpeg header/packet timestamps; Opus for WebM music, silent-source support, music offset/padding and visible mix failures; indexed uploads preserve positions in mixed project/upload timelines. Baked music is muted on the separate audio track to prevent double playback or needless export rendering. Original source files are preserved.

Verification:

- 66 frontend tests pass.
- 15 backend tests pass, including real synthetic WebM/audio renders with no ffprobe, full duration, copied VP8 video, and Opus audio.
- `scripts/tests/video-film-runtime.py`: real browser/media playback with mocked generation APIs; delayed polls never overlap, an old result is ignored, one authenticated download replaces the timeline, duplicate/foreign completion events are ignored, and the resulting three-second video plays.
- Evidence: `video-film-edit-20260916.json`.

Existing truncated generated files remain unchanged. Restore the original clips from editor history before regenerating if an earlier result was shortened.
