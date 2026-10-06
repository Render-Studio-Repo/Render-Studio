# Preferences redesign — 2026-09-16

Screenshots use an isolated test account with mocked APIs; no real accounts were connected, disconnected or modified.

- Full Studio: 11 scenarios passed with zero page errors, including all 14 settings sections, profile draft/save wiring, all 15 app dialogs, mobile hit testing, deep links and the Preferences walkthrough.
- Connection dialogs: 10 isolated scenarios passed, including missing configuration, independent status failures, Stripe onboarding, X PIN, manual wallet entry and clipboard fallback.
- Profile: dark/light desktop and mobile layouts, public/compact overlays, keyboard focus and asynchronous loading/error/close behavior passed.
- Focused Node suite: 14 tests passed. Syntax checked all 19 affected JavaScript modules.
- Images were visually inspected. No physical phone or Quest verification, live provider OAuth, payment or wallet transactions were performed.

Repeatable checks: `scripts/tests/preferences-studio-runtime.py`, `scripts/tests/authorized-app-setup-browser.py`, `scripts/tests/preferences-profile-runtime.py`.

Provider credentials still need server configuration where indicated. Streaming currently stores a destination without completing provider authorization; the UI states this and provides provider-studio links and developer instructions. No backend changes or restart. Static cache release: `settings-redesign2`.
