# Parts List and micro-edit verification — September 15, 2026

## Why this project's electronics were missing

Project `f730285c`, prompt `53ddf4043fff`, trace `b643b400` failed during VibeCAD construction with `KeyError: legacy_petg_terminal_boot_negative`. It did not publish a completed model. Its authoring manifest contained a parts list, but the prior workspace importer only consumed the standalone parts JSON, McMaster sources and wiring.

The importer now recovers revision-stamped manifest parts without overwriting geometry. The project has 289 draft entries: **111 electronics/wiring, 84 McMaster, 94 fabricated/mechanical**. These are recovered design references, not a verified purchase-ready BOM. Some rows describe battery sub-bodies or use a reference robot page. Draft warnings and unresolved specifications remain visible; the sourcing skill now requests purchasable components rather than a purchase for every decorative solid.

## Using the extension

- Open the cart beside **Browser**, or click **Reference Files → Parts List** (hover for its cart button).
- The viewport Parts List tab includes Home, Electronics, McMaster and Mechanical, search, sorting, list/grid, documentation links and Follow-up questions.
- **Find STEP / electronics** searches the existing catalog first. Actual source IDs, model URLs and explicitly supplied documents are retained. It falls back to external source search when no catalog result exists. Catalog pages are labeled as sources, not verified datasheets. Live Raspberry Pi 5 lookup returned matching STEP geometry in 0.53 seconds during verification.
- **Link selected mount** binds the current model revision and selected geometry. Ask Render Agent for alternatives; review each proposed replacement before approving. **Generate with AI** prepares Edit selected with the approved changes and restores captured face selections only if the model revision still matches. Generation remains explicit.
- The compact **Micro edits** row is below the toolbar. Choose a CAD model with a STEP source, configure body/face scope, and run. The shared path works with STEP outputs from any CAD harness; it leaves the original authoring source and geometry intact.
- **Debug** selects models from the current AI source, repeats per model and prompt variants. Maximum 10 outputs per run and one optional repair pass. Each variant starts from the same immutable source snapshot. Results have View, STEP/GLB downloads, log download, and Rate 1–5. Model context menus also include Rate model.
- Ratings cover intent, dimensions, preservation, mounting/assembly fit and overall result. They are stored with the run/model/revision and existing training feedback. Human ratings remain distinct from objective kernel validation.

## Actual model comparison

[Open benchmark project](https://render3d.app/?project=a81df510). Final run: `8506491614444c6d`.

Instruction: enlarge a mounting plate's through-hole from Ø4 to Ø6 mm and shift it +3 mm along X, preserving the plate, adjacent enclosure block and materials. Source: a 40 × 30 × 5 mm plate and a separate 10 mm cube. Two trials per model, one per prompt variant, no repair passes, through the user's ChatGPT subscription.

| Output | Model | Prompt variant | Plan + kernel/export | Objective checks |
|---|---|---|---:|---|
| Debug 1 | gpt-5.6-luna | minimal | 8.32 s | Pass |
| Debug 2 | gpt-5.6-luna | constraints | 8.36 s | Pass |
| Debug 3 | gpt-5.6-terra | minimal | 9.15 s | Pass |
| Debug 4 | gpt-5.6-terra | constraints | 7.85 s | Pass |
| Debug 5 | gpt-6-astra | minimal | 22.80 s | Pass |
| Debug 6 | gpt-6-astra | constraints | 9.65 s | Pass |

All six final STEP exports were reopened and measured: one Ø6 mm through-hole centered at X=3/Y=0, plate bounds unchanged, neighboring solid unchanged, both colors preserved. Original STEP checksum matched its recorded revision. Every GLB had finite vertices. All completed without repair or history/feedback logging warnings. Per-output times exclude the shared initial source inspection; the JSON records total run and per-attempt timing separately.

Mean times in this small fixture: Luna **8.34 s**, Terra **8.50 s**, Astra **16.23 s**. Two samples per model do not establish general reliability or a universal winner. The default micro-edit candidate is Luna when offered by the selected AI source; other models remain selectable and no credential source is switched. Small prompts, low reasoning effort and avoiding full source regeneration follow the [official latency guidance](https://developers.openai.com/api/docs/guides/latency-optimization).

Earlier development runs are retained in the benchmark project for traceability: `4ec0336c80f14152` exposed an operation-key mismatch; `8d777cc3d0374f16` exposed lost STEP color after boolean edits. Both were fixed. The downloadable ZIP contains only the final six corrected variants and their original fixture. Each final trial has a distinct project-history trace so repeated prompts retain separate usage totals. No subjective user ratings have been fabricated.

## Scope and limits

Supported operations: move a body, small body scaling, resize/move complete cylindrical through-holes, and small planar-face offsets. Hole growth can also handle suitable blind holes; relocation/shrinking require through-holes. The kernel rejects invalid/disconnected results, stale/out-of-scope IDs, unsupported features and ambiguous plans. Surface edits precede body transforms; offsets that invalidate anchors require a separate inspected edit. This is not a full direct-modeling kernel for arbitrary fillets, threads, slots or multi-part redesigns.

Small edits only update the viewport after a validated export finishes. No speculative per-token geometry rendering was added. Outputs are separate named project assets; editing source history and joint constraint recreation are not part of this micro-edit path. Project-scale assemblies may need a smaller mounting subassembly (100 MB STEP, 2,048 solids, 500 faces per selected body limits).

Logs are capped at 200 runs / 20 MB per project, with ratings merged safely during active runs; shared learning feedback retains its existing 500 MB cap. Generated models are user files and are not pruned with logs. No automatic prompt rewriting was enabled by these changes.

## Verification

- Python: 38 tests passed across kernel, parts recovery, catalog, authenticated routes and rating persistence.
- JavaScript: 20 tests passed for source grouping, filtering, scoped geometry references, model selection/counts and document tabs.
- Real Chromium: Parts List tabs, 111 electronics rows, battery search (7 rows), list/grid; CAD body/face scope; multi-model Debug controls; all six saved results; performance log download; five-category rating form.
- A full frontend module parse found an unrelated duplicate `preview` declaration in video sharing that prevented editor boot. The variable was renamed and the editor started successfully. Late startup restoration now respects an active Parts List tab.
- No purchases, live robot actions, or edits to the original mobile-base geometry were performed.
