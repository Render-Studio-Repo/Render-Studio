# Render Studio public worklog

## 2026-10-06

### Connected instance administration and bug inbox

- Made the first real account created on a fresh self-hosted installation its local platform administrator; bundled marketplace profile records are excluded from this decision.
- Kept the standard Report Bug action in the current installation's management queue and added a separate Instance Bug action on desktop and mobile for sending installation/ecosystem problems to central Render management with the instance ID.
- Added authenticated instance registration, heartbeat, and support/bug submission endpoints for connected public installations.
- Added a privacy-limited central registry and management inbox that stores hashed instance credentials, aggregate instance metadata, redacted reports, retry deduplication, unread state, and no IP, hostname, project, prompt, or user identity data.
- Added administrator-only overview and read-state endpoints compatible with the Render management Instances panel.
- Added focused coverage for initial administrator selection, instance authentication, redaction, deduplication, search, overview shape, and inbox read state.

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
