# Documentation visual assets

This folder contains the small set of presentation assets used by the repository landing page.

| Asset | Purpose | Source |
| --- | --- | --- |
| `render-studio-hero.png` | Wide project identity image | Generated for the repository; intentionally contains no embedded words or logos. |
| `render-studio-tour.gif` | Six-second overview loop | Composed from the repository's real `ai-generate.gif`, `robotics-viser.gif`, `wiring.gif`, and `vr-menu.gif` documentation recordings. |
| `render-studio-workflow.svg` | Readable end-to-end workflow | Native SVG so labels remain sharp and easy to update. |

The detailed feature recordings remain in `frontend/docs/media/` and are used by the in-app documentation catalog. Prefer those focused GIFs when documenting one exact control or workflow.

When replacing an asset:

1. keep the same file name unless every reference is updated;
2. avoid credentials, personal projects, customer data, and browser chrome with private tabs;
3. use real product UI for instructional media;
4. reserve generated imagery for conceptual or brand-level artwork;
5. verify the final dimensions, frame count, file size, and Markdown links.

