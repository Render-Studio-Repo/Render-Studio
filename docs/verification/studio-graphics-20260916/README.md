# Studio graphics startup and context use — 2026-09-16

All browser checks used isolated synthetic data and mocked account APIs. Screenshots were inspected. No real projects/accounts were changed and no robot/provider calls were sent.

The current app was initially observed constructing its main renderer without a catch. During inspection, a concurrent edit added two immediate attempts followed by a silent renderer. The saved baseline reproduces a blank viewport after four temporary getContext refusals, even though a subsequent allocation would succeed.

The corrected startup uses native Three r172 WebGLRenderer and WebXRManager, without pre-binding a context or using WebGL1. It yields for bounded compatible retries, caps compatible pixel ratio, keeps non-3D controls usable on permanent failure, preserves browser diagnostics, and offers explicit retry. A disabled graphics backend remains a browser/device issue; signing in cannot re-enable it.

Verification:
- 16 focused Node tests passed; 12 affected JS modules passed syntax checks.
- Four full Studio scenarios passed: healthy boot, transient refusal recovery, permanent refusal with failed then successful explicit Retry, and disabled backend. Zero page errors. Native XR manager retained.
- Synthetic model rendered in the actual Studio renderer; pointer selection and orbit, Design ↔ Wiring switching, prompt input, Preferences, and Docs 200 verified. Test-only response instrumentation exposed existing scene/control references; production has no QA hook.
- 12 loaded GLB mini previews across all three import consumers used exactly one WebGL context. Closing all yielded zero; reopening reacquired one and closing released it.
- Wiring thumbnail batch used one context, dropped to zero after idle, and reacquired on the next uncached capture. Shared source geometry/materials were not disposed.

The mini-viewer pooling implementation arrived concurrently. This task unified the three distinct import URLs so there is one actual pool, and added last-view cleanup. A concurrent removal of context release was caught by the browser test; Three dispose alone kept the context live. Explicit release is restricted to the closed offscreen preview and thumbnail renderers, never the live Studio/XR context.

Other optional consumers include the separate 3D wiring workspace, code preview, avatar preview, recording preview, and marketplace model viewer. This is a code inventory, not a count of contexts in the user's open browser tabs. Physical Quest/current Chrome state remains unverified because Computer Use permissions were pending.

Repeatable scripts: `scripts/tests/studio-graphics-startup-runtime.py` and `scripts/tests/studio-graphics-contexts-runtime.py`. Static release: `gpu=20260916-startup3`. No backend restart.
