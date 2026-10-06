# RnD benchmark plan — Sam’s mentioned features

**Author:** vibe-rnd (Rick)  
**Token:** `mktpitch1` (this plan) · keep `sandbox1`–`sandbox4`  
**Date:** 16 Sep 2026  
**Rule:** measurable latency / tokens / incidents. **No fake dollars.** WebGL count stays **1**. Sandbox writes that escape `frontend/sandbox/` fail.

Live: `/sandbox/index.html` Notes → RnD benchmarks. Board: `/team-chat.html`.

| Feature | Metric | How to measure | Pass bar |
|---|---|---|---|
| Round table / voices / TTS mutex | Overlap-speech incidents; floor hold ms | `occupyFloor` + `enqueueSpeak(..., {ifBusy:"text-only"})` in `tts-mutex.test.js`; headset: two seats talk | **0** overlapping `speechSynthesis` utterances; queued audio waits |
| TTS unique voices | Distinct `voice` ids per seated agent | `uniqueSeatVoices(roster)` | Set size == roster length |
| Sandbox super IDE / live edits | Rev lag; write jail | Poll `/mcp/sandbox/rev`; `grok_sandbox` write `../studio/app.js` | Hot reload ≤ **3 s**; jail **ValueError**; keep sandbox1–4 files |
| VR controls hot-reload | Control `rev` applied; extra WebGL | `GET /mcp/sandbox/controls`; `countSandboxWebgl()` / office `WebGLRenderer` count | rev increments; **WebGL=1**; no production `app.js` edit |
| Clip-bot concrete print + gen CAD | Contract verify; cede not reset | `cede_example` `apply=false`; clip-bot CAD curriculum | No production reset; print only after verify window |
| Team chat images / replies / emoji | Upload allowlist; reply_to; react toggle | `grok_group_chat` action `upload`/`post`/`react` | Image host allowlisted; reply folds preview; react is toggle not duplicate spam |
| Analytics cost reports | Real ledger rows | `grok_stats` / `action=cost_report` | Token/ms/job counts from logs; **no invented $** |
| Voice select / AIs approach | PUT voice + approach flag | `/mcp/sandbox/voice`; round-table `approach` | Distinct voice; `token=sandbox4`; one speaker |
| Sandbox-off hides shapes | Visibility vs destroy | `setSandboxShapesVisible(root, false)` | `visible=false`, `destroyed=false`, CAD remains; WebGL still 1 |

## Method (do this, don’t guess)

1. **Baseline** — one run with Sandbox off: WebGL canvases = 1, TTS floor empty, shapes hidden.
2. **On** — Sandbox on: shapes visible, super IDE live, round table seats.
3. **Load** — 10 idea-toss turns; count overlap incidents and p95 speak start latency.
4. **Edit** — write `frontend/sandbox/examples/bench-note.md`; time until Files tab rev refresh.
5. **Jail** — attempt path `../studio/app.js`; expect fail; confirm app.js mtime unchanged.
6. **Chat** — post image + reply + emoji; confirm fold on `/mcp/team-chat/feed`.
7. **Cost** — pull last session tokens from debugger/cost-report APIs; publish numbers as-is.
8. **Off** — Sandbox off; shapes hidden not disposed; WebGL still 1.

## Out of scope

Paid Generate, live X posts, fake follower counts, extra WebGL contexts, wiping sandbox1–4.
