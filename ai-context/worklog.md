# Render Studio public worklog

## 2026-10-06

### Connected instance administration and bug inbox

- Made the first real account created on a fresh self-hosted installation its local platform administrator; bundled marketplace profile records are excluded from this decision.
- Kept the standard Report Bug action in the current installation's management queue and added a separate Instance Bug action on desktop and mobile for sending installation/ecosystem problems to central Render management with the instance ID.
- Added authenticated instance registration, heartbeat, and support/bug submission endpoints for connected public installations.
- Added a privacy-limited central registry and management inbox that stores hashed instance credentials, aggregate instance metadata, redacted reports, retry deduplication, unread state, and no IP, hostname, project, prompt, or user identity data.
- Added administrator-only overview and read-state endpoints compatible with the Render management Instances panel.
- Added focused coverage for initial administrator selection, instance authentication, redaction, deduplication, search, overview shape, and inbox read state.
- Centralized self-hosted suggestions and bug reports in the official hub while retaining the full local record on the originating installation. Central copies contain the stable source instance and report text without user identity or project content.
- Restricted the aggregate Instance Management API to platform administrators on the official Render hub.
- Added GitHub issue and pull request tracking to Instance Management, including creating an issue from a report and opening, closing, or reopening linked work through the signed-in administrator's GitHub connection.
- Added a locked public release boundary in `AGENTS.md`, `PUBLIC_RELEASE_BOUNDARY.md`, and the public release audit so hosted super admin UI, aggregate management modules, private marketplace operations, production data, and private profiles cannot be added silently.
- Added automatic SQLite initialization to installer bootstrap. Backend startup continues to run the same idempotent schema initialization.
- Added a current-instance-only management endpoint and dashboard for self-hosted administrators. It shows local account, project, storage, connection, version, and feedback totals without exposing other instances or hosted settings.

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
## 2026-10-06 — Safe connected-instance updates

- Added a stable release pointer backed by the public `wprojects/Render-Studio` `master` branch. Production site edits cannot move the pointer.
- Connected ecosystem instances now opt into admin update notices. Installation remains a deliberate admin click.
- Hardened update preflight to require the exact stable commit, a clean tree including untracked source, fast-forward history, and a diff outside protected runtime and private-admin paths.
- Kept projects, data, backups, logs, credentials, and instance-only modules outside the update boundary.
