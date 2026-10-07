# Mobile UI verification — September 16, 2026

Release: `20260916-mobile-taps2`.

`python scripts/tests/mobile-layout-runtime.py` uses the production DOM/CSS and mobile/nav/gizmo modules with inert application callbacks. Chromium touch emulation passes 320×568, 390×844, 430×932, 844×390 and 1024×768. Desktop 1440×900 retains the visible transform panel. Checks cover native menu taps, scrolling to the last action, menu close/backdrop cleanup, popup exclusivity, hit targets of at least 44px, viewport bounds and control overlap. No fixture page errors. Phone and landscape screenshots inspected.

Seven focused mobile chrome Node tests and syntax checks pass. Broader chrome/navigation/transform checks: 37 pass, three fail on pre-existing literal HTML assertions (Tips & Tricks whitespace and app version prefix). All three assertions also fail against the index.html backup made before this task. No unrelated tests changed.

Live guest smoke: Studio and Docs HTTP 200, seven canvases and final mobile stylesheet loaded. Guest page shows the login screen and existing Not authenticated request error. No authenticated end-to-end or physical phone testing claimed. No backend restart or project changes.
