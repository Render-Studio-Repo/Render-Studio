# Project loading performance — September 15, 2026

## Viewport follow-up: avoid copying every CAD face on load

The robot GLB has **5,447 meshes**. Its fresh GLTF parse already owns its geometry and materials, but the loader copied every mesh's geometry and material again. That created **5,447 material instances from one shared material**, increasing preparation and rendering work even when the download was cached.

- Fresh loads now retain their resources. Only actual geometry aliases are detached; skinned geometry retains its bindings. Export and texture-edit clones still use the existing full-detachment helper.
- Individual transparency and tint changes isolate shared materials when needed. Selection, original vertex colors, and all 5,447 meshes remain intact.
- Project framing runs once when bounds are ready, retrying only when they are not. Local geometry bounds are reused until the position attribute/version changes or bounds are invalidated, instead of rescanning vertices on every camera fit. World transforms still update normally.
- Frontend module versions were updated. No backend restart is needed.

Public-site Chromium measurements, with host WebGL and profiling enabled:

| Open | Earlier trace | Final trace |
| --- | ---: | ---: |
| Headset, repeat | 694 ms | 636 ms |
| Robot, repeat | 1,551 ms | 1,057 ms |
| Robot, first measured download | 1,704 ms | 1,654 ms |

These are individual samples, not a guarantee for every load. Metadata/download latency varies; the repeat robot metadata request alone varied from 489 to 306 ms. A separate old-loader control with collaboration traffic held idle measured 1,200 ms for the repeat robot open, versus 1,057 ms for the final loader. The controlled runs confirmed the change from 5,447 materials to one. Models still require parsing and GPU upload; CAD Debug is not running benchmarks during these opens.

Validation: **41 targeted Node tests passed**, module syntax checks passed, and live-browser opens had no page errors. Browser interaction checks verified independent transparency, restored opacity, unchanged sibling color, and part selection. Final profiling held collaboration WebSockets idle to prevent other sessions switching the project during measurement; this is not a multiplayer or headset verification.

[Viewport resource and framing verification](verification/viewport-loading-resources-20260915.json)

## Live-site follow-up: workspace folders and Debug comparison

Tested Debug off → on → off on **render3d.app** while opening the headset and robot projects. Both browser runs had zero micro-edit API requests and no page errors. The robot's warm opens after the fix measured 1,065 ms with Debug on and 1,087 ms with it off. These traces do not identify Debug as the loading bottleneck, so Debug remains available.

Found and removed additional redundant backend work:

- Every workspace folder request calculated its public-project count by fetching each public project's remote access permissions. The folder needs only the count; it now skips those unnecessary permission reads. Folder membership enforcement and project access checks remain in place.
- All-workspace project lists fetched personal-workspace memberships even when the private-project helper immediately returned no extra rows. That path now returns before making the unused request.
- Grouping shared workspace projects fetched the same team list twice. It now shares one fresh result within the operation, including an empty list.

Single live-browser before/after captures:

| Request | Before | After |
| --- | ---: | ---: |
| Project list | 1,446 ms | 959 ms |
| Workspace folders `be195dc6` | 3,615 ms | 964 ms |
| Workspace folders `771b6c41` | 3,386 ms | 591 ms |
| Workspace folders `411c7bf6` | 3,615 ms | 964 ms |

This removes work from workspace loading; it does not make every model open instantaneous. The robot's first open varied from 1,687 ms before to 2,477 ms after, including metadata latency, its 8.9 MB GLB download, and parsing/rendering. Warm robot opens remained around 1.1 seconds. No claim of a first-model-open improvement is supported by this capture.

Validation: **29 Python tests passed**, including five new workspace request regression tests plus existing permission and project-list tests. The tests check membership denial, unchanged folder permissions, grouping behavior, and avoided redundant reads. Backend restarted and the public site was verified. No frontend assets changed in this follow-up.

[Live-site Debug A/B measurements](verification/project-loading-debug-ab-20260915.json)

## Evening follow-up: project loading and CAD Debug

The benchmark/debug tools made **zero micro-edit API calls during startup and project switching**. No benchmark workers were running. The traces do not support blaming background benchmarks for the delay.

Additional delays found and fixed:

- `early-boot.js` requested the project list and discarded the response; `app.js` then fetched the list again. Boot now leaves the list to the editor, which already has an account-scoped cache and in-flight deduplication.
- Workspace switching waited for member and invite-candidate requests before requesting projects. Optional people UI now refreshes after the project list is painted.
- Project open fetched identical Supabase access and membership rows for both read and edit permission checks. These rows are now reused within that **single read response only**. Every new request checks fresh permissions; different users, teams and projects have separate keys. No access decision survives a request.

CAD Debug is now in a dedicated row **under Target in the CAD prompt panel**, next to **Benchmarks…**, with Micro edits and Configure edit below. It remains available when the viewport ribbon is hidden. The old duplicate Debug button in the global ribbon was removed. Informational CAD tooltips no longer intercept clicks on controls underneath; Escape dismisses the CAD/Mesh engine picker. The tools hide in Render and Mesh modes.

Enabling Debug or Micro edits makes no benchmark/inspection request. Benchmarks explicitly opens geometry inspection and a review dialog. With Micro edits and Debug enabled, Generate opens benchmark review; it does not run models until **Run benchmarks** is clicked. Regular CAD diagnostic prompt fields remain supported.

Browser verification: Chromium, host WebGL, 1440×1000, localhost, three existing projects opened then revisited. Repeat-open timings (through two animation frames):

| Project | Before | After |
| --- | ---: | ---: |
| Headset `2ee4d857` | 862 ms | 668 ms |
| Robot `f730285c` | 1,215 ms | 1,011 ms |
| Robot `55f0de44` | 1,348 ms | 1,028 ms |

Average repeat open improved from 1,142 to 902 ms (21%). Revisited models transferred zero GLB bytes before and after: the earlier byte-cache fix is still working. Startup made one project-list request after the fix, previously two. The first measured robot open varied (1,112 → 1,230 ms); this is not a claim that every cold load is faster or instantaneous. Large models still need GLB parsing and GPU upload/rendering; Supabase latency also varies.

Validation: 27 Python tests and 39 targeted Node tests passed; browser checks had no page errors, verified Debug on/off, hidden controls in Render/Mesh, benchmark review routing, and zero benchmark runs. The broader boot/auth tests had 21 passes and one existing unrelated failure: the toolbar test expects the removed “Tips & Tricks” label. Asset versions were updated and the public origin was checked for the new HTML/JS. The backend restarted with no active generation jobs.

- [Measurements and UI checks](verification/project-open-debug-20260915.json)
- [CAD controls screenshot](verification/cad-debug-visible-20260915.png)
- [Benchmark review screenshot](verification/cad-debug-benchmarks-20260915.png)

## Investigation

Compared the 11:32 CDT code snapshot (`20260915T163230Z-watchdog`) with the current frontend (last-hour edits through 12:11). Those changes primarily added video sharing and canvas grid behavior. The project-open path was unchanged and the older snapshot reproduced the loading delay; there is no evidence that reverting the latest sharing work would fix it.

Browser traces identified these costs:

- A project switch forced a new timestamp onto unchanged model URLs, bypassing HTTP cache.
- Both the frontend response helper and the HTTP middleware sent `no-store`, requiring all app modules/styles to transfer again on reload.
- Multiple project-open UI hooks reset the WebGL drawing-buffer size even when its size had not changed.
- Project `f730285c` contains an 8.9 MB GLB with 5,447 meshes. Parsing, uploading, and rendering that existing asset still costs more than a small model.

## Changes

- File listings include an opaque revision from file modification time and size. Model URLs remain stable across project switches until that revision changes. Explicit edits/generation invalidate the cache; legacy previews without revisions still refresh on project open.
- A per-account preview byte cache retains at most 64 MiB / 8 entries, evicts least-recently-used blobs, deduplicates concurrent requests, and clears on account changes or edit invalidation. It retains bytes, not live scene objects. Scene ownership and disposal rules are unchanged.
- Static modules/styles use ETags and revalidate every request. HTML stays uncached. A source edit returns new bytes even if an import version was not updated. The outer HTTP middleware preserves these headers. Explicit `Cloudflare-CDN-Cache-Control: no-store` and `CDN-Cache-Control: no-store` prevent the public CDN from turning this into a four-hour cache; the browser still retains and validates bytes. Public HTTP verification returned `BYPASS` and the original `no-cache, max-age=0, must-revalidate` policy. See [Cloudflare header precedence](https://developers.cloudflare.com/cache/concepts/cdn-cache-control/).
- Viewport/scissor/clipping restoration still runs, but drawing-buffer allocation only runs when size or pixel ratio changed (including restoration after recording/XR).

## Verification

39 Node tests and 40 Python tests passed, including cache eviction, account isolation, failed fetch retry, same-name/same-size file replacement, middleware-level 304 responses, and existing project ownership/recovery checks. ES module syntax and Python compilation passed.

Chromium opened/switched the headset and robot-base projects without page errors. Repeat opens issued zero GLB network requests. On browser reload, local scripts/styles transferred about **112 KB instead of 13.1 MB** (over 99% less); 371 assets reused cached bytes. On **render3d.app**, the equivalent compressed script/style transfer fell from **3.40 MB to 112 KB** on reload; startup readiness was 5.14 seconds cold and 2.78 seconds on that warm reload, with no page errors. These are cold/warm readings of the fixed version, not a controlled before/after wall-clock comparison. All transfer figures exclude model downloads and third-party assets.

Wall-clock timings varied with the live server and GPU load. The verification demonstrates eliminated transfers and redundant buffer allocations; it does not establish that every project opens instantly. The dense robot asset still needs to be rendered. Live VR/headset behavior was not retested for this loading-only change.

Measurements: [project-loading-performance.json](verification/project-loading-performance.json).
