# Chrome / Electric / Matrix — alternate Render loading animation

Open `index.html` in a browser. This is a standalone preview, not wired into the live loading screen.

- Uses a copy of the current `frontend/render3d-logo.png`, with the original R face, bevels, and lower exhaust details.
- A separately drawn metal gear rotates behind the letter. Chrome reflections sweep over its face; blue current follows the outline and crosses the metal, with orange/cyan sparks below.
- Eight-second timeline: energize 0–1.5s; chrome, gear and electricity 1.5–5.25s; Matrix code enters at 5.25s and fills the R through the finish. The preview then stops. Replay, pause and scrubbing are available.
- Canvas only; no dependencies, network requests, server work, telemetry, authentication, or Studio state access.
- Animation pauses in hidden tabs. Reduced-motion preference shows a still composition. Rendering resolution is capped at 1.5× and 1,350px wide.

`animation-preview.webp` is the compact, looping review export; `animation-preview.gif` provides a GIF fallback. Both are captured from the actual browser animation. The editable source is `animation.js`; `render-logo.png` is the unchanged source logo copy. `render-chrome-electric-matrix.html` is a portable version with its script and logo embedded.

## Preview controller

`window.renderChromePreview` provides `seek(milliseconds)`, `setProgress(0..100)`, `play()`, `pause()`, `replay()`, `complete()`, `destroy()`, and read-only `ready`, `playing`, `duration` properties. These controls are scoped to this preview; they are not a drop-in replacement for Studio's boot lifecycle.

## Before live integration

The current desktop splash has a five-second minimum and a six-second fail-open path; its two dismissal paths do not both honor the optional completion hook. Shorten the sequence or trigger the Matrix outro from real readiness without delaying startup. Preserve headset entry, suggestions, walkthrough handoff, and all boot cleanup. Review deployment with Sam before wiring the animation into the live screen.

## Verification

Viewed Chrome screenshots at desktop and 390px mobile widths. Replay/pause, no horizontal overflow, reduced motion, script syntax and browser errors checked. No production files, services, loading timing, or feature behavior changed by this alternate preview.
