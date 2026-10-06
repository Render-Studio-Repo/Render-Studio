# CAD Parts Catalog fallback — 2026-09-16

The common CAD sourcing policy now requests official manufacturer STEP/STP first, Parts Catalog/Browse parts second, and other sources third. Existing verified project geometry is reused. Catalog misses and network errors are distinguished; unknown variants/dimensions remain questions.

Integration points: shared CAD context (VibeCAD and MAC), CAD brief, Feature Program/design generation, Python CAD authoring, Jake tool system prompt, Improve prompt, and bundled CAD/VibeCAD/step-parts/replacement instructions. Jake now has real `search_parts_catalog` and `import_catalog_part` tool dispatch. VibeCAD reuses its existing catalog tools.

No duplicate API was needed: `/api/design-assist/parts/catalog/search?q=...&fallback=false` uses the same step.parts provider as Browse parts. Queries are limited to 180 characters, eight catalog candidates, a six-second request timeout, and a ten-minute cache. Improve prepares sourcing instructions without performing catalog queries ahead of official lookup. It never imports geometry.

Imports retain verified source URLs, documents, thumbnails and specs. Existing purchase IDs, quantities and mount references survive enrichment. CAD-only results keep their profile/docs and a purchase-source question, not a fabricated shopping entry; repeat imports reuse their local STEP.

Validation: 37 targeted tests pass across sourcing policy/tool execution, actual local import/profile/list persistence with mocked downloads, purchase deduplication, and shared CAD hardware context. External provider availability and a paid AI generation were not tested.
