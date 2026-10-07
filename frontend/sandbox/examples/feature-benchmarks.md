# Sandbox feature benches (`rndbench1`)

Live plan for Analytics + Voice. Canonical agent copy: `Getting-Started/agents/PLAN-RND-BENCHMARKS.md`. Do not auto-apply harness. Never wipe notes. Never invent dollars.

Voice speaks the `speak` line through `frontend/sandbox/tts-mutex.js` (`ifBusy=queue`). Analytics charts pass=1/fail=0 per `bench_id` on the analytics desk (`charts.js` / `GET /mcp/stats`).

| bench_id | lane | metric | measure | pass | fail |
|----------|------|--------|---------|------|------|
| B-VR-TTS | Round table · listen · TTS mutex · distinct voices · approach | `mutex_overlap_ms=0`, distinct voice count | `tts-mutex.test.js`; Talk+listen in headset; `floorHolder()`; sandbox debugger `synthOk`/`recOk` | Unique `AGENT_VOICE`; one speaker; listen probed | Overlapping TTS; duplicate voices; fake listen |
| B-SB-IDE | Super IDE · sandbox-only live edits · Projects swap | `webgl_count=1`, rev hot-refresh ms | `super-ide.test.js`, `vr-projects.test.js`, `GET /mcp/sandbox/rev` | One WebGL; menu = `frontend/sandbox/` files; rev bumps iframe | Second WebGL; CAD projects leak into swap |
| B-CHAT-UI | Team chat images · replies · emojis · size | post/image/reply/react ok + center width px | `POST /mcp/group-chat` post/react; feed `/mcp/team-chat/feed`; CSS `.team-chat` max 1400px | `msg_gc_*` + `reply_to` + react row; allowlisted image URL; wide center | Remote image; skinny column; no persist |
| B-XR-CTRL | Live VR controls endpoint · Simulate sandbox controls · success notes | poll ≤800ms, simulate flag, success note count | `/mcp/sandbox/controls`; overlay button; `control-notes.jsonl` | Bindings update without page reload; simulate≠prod map; success notes kept | Reload; auto wire-scene; wipe fail notes |
| B-DBG-COST | Privileges · damage/outcome · cost reports · votes · risk vs reward | tokens/time; currency unknown unless priced; YES/HOLD/NO | `/api/ops/debugger-analytics/sessions/close`; `test_debugger_cost.py`; `decision-brief.js` | `cost_*` + speak; no fake $; ask_safe queue only | Invented USD; auto privilege; fake majority |
| B-CLIP-CAD | Clip-bot concrete 3D print + generative CAD | cede pending=1, auto_apply=0 | `curriculum/clip-bot-cad-print.md` + `cede_example` | pending_approval; layer/nozzle/infill in example; no serial | Auto-apply; live job invented |
| B-MKT-DECK | Marketing AI presentations · PDF slideshows · social growth | draft_n; live_tweet_n; pdf_pages; follower_delta or unknown | `grok_marketing`; PDF page count; `x_post confirm=false` | Draft exists; pages≥1; live tweets only with Sam; growth from API or unknown | Fake tweet URL; guessed followers |
| B-BAMBU-VR | Bambu VR plates · Astra reorient (if present) | plate_n; reorient_ok or skip | VR Export to slicer; `slicerPlateCommand` action=reorient | ≥1 plate when model open; Astra still `marin` | 0 plates on open model counted as pass |

## Voice (sandbox)

```
enqueueSpeak("analytics", row.speak, { ifBusy: "queue" })
```

One floor. Distinct voices already mapped: astra=marin, rnd=ballad, analytics=sage, clip=ash, mkt=coral.

## Analytics ingest

Post `rs.bench.v1` JSON (see agents plan) as a board `REPORT` or `/mcp/reports` row. Join `bench_id` + `log_id`. Plot pass rate this cycle. Do not draw a dollar axis.

## Simulate controls

Button **Simulate sandbox controls** is the control bench, not a ship of Sam’s scene. Notes of what succeeded stay in `frontend/sandbox/control-notes.jsonl`.
