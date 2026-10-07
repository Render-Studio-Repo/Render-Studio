# Render Studio public worklog

## 2026-10-06

- Merged current `master` into the complete public release branch for PR #30.
- Preserved the canonical setup page at `frontend/pages/setup.html` and removed the obsolete duplicate setup files introduced by the installer branch.
- Combined the public release and desktop installer verification contracts.
- Updated installer behavior coverage for hosted Render login and independent local setup.

### Ecosystem marketplace federation

- Connected installs now register a stable instance ID with a credential bound to that ID.
- Successful enrollment enables publishing while health metrics remain a separate opt-in.
- Shared marketplace catalog pulling now executes for remote instances.
- The hub accepts only explicitly approved public listing payloads.
- Made the mandatory public release verifier runnable before installation by removing checks that assumed a Unix `.venv` path. Installed-environment behavior evidence remains recorded in the release receipt.

## Public documentation expansion

- Expanded the repository README with product capabilities, platform installation steps, setup modes, AI configuration, API entry points, marketplace federation, data paths, privacy boundaries, updates, troubleshooting, and a documentation map.
- Updated the marketplace hub and open-source boundary guides to match per-instance credentials and public-only listing ingestion.
