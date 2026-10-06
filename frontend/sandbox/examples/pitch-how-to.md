# How to generate a pitch deck (`mktpitch1`)

Keep `sandbox1`–`sandbox4`. Do not auto-publish social posts.

## MCP / HTTP

1. `grok_pitch_deck` with `action=generate` (optional `topic`, `slides` array of `{title, bullets}`).
2. Or `POST https://render3d.app/mcp/sandbox/pitch` with the same JSON.
3. Or `grok_sandbox` `action=pitch` (`text` = topic).

Writes (sandbox jail only):

- `frontend/sandbox/examples/pitch-social-growth.md` — outline + `---` slides
- `frontend/sandbox/examples/pitch-social-growth.pdf` — printable slideshow
- Super IDE **PDF** tab loads the deck; **Notes** tab loads the outline

## Pointer-to-slides (VR / sandbox)

Same Draw/point idea as Bambu plates (`bambu1`):

- Point the **left third** of the PDF → previous slide
- Point the **right third** → next slide
- Center stays on the talk track
- Round table **Slides** surface also steps on left/right UV

Desktop: click the pitch canvas sides, or Prev/Next.

## Social track

Handles: `@a1_projects`, `@winstead_works`. Never invent follower counts. `x_post confirm=false` until Sam confirms.
