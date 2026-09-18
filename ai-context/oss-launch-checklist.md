# OSS launch checklist

Purpose: on self-hosted / OSS Studio hosts, the first browser launch should show a one-shot checklist that confirms the install is genuinely clean before anyone treats it like a fresh demo or first-run experience.

## Behavior

- Frontend module: `frontend/oss-launch-checklist.js`
- Styles: `frontend/oss-launch-checklist.css`
- Public route: `GET /api/oss-launch-checklist`
- Backend inspector: `backend/services/oss_launch_service.py`

## Gating

- The checklist is meant for **non-`render3d.app` Studio hosts**.
- On self-hosted hosts it intentionally suppresses the older unsigned-user welcome modal (`render3d:welcomeSeen:v1`) so the two first-run experiences do not stack.
- It is **one-shot per browser per host** via `render3d:ossLaunchChecklistSeen:v1:<host>`.

## KB cleanliness contract

Step 1 is the load-bearing rule:

- **PASS / clean** only when:
  - `knowledge_bases`, `knowledge_folders`, `knowledge_items`, `knowledge_skill_links`, and `knowledge_shares` are all empty
  - `data/knowledge/` has no KB directories or stored files
- **FAIL / dirty** when the KB data is consistent but non-empty
- **FAIL / half-seeded** when DB + disk disagree, rows point at missing KBs, item files are missing on disk, or stray/orphan KB storage exists
- **FAIL / inspection_error** on any unexpected exception

This is intentionally **fail-closed**. Ambiguous or partially-seeded states must never present as clean.

## UX details

- No fake progress bars or % meters; the modal uses plain PASS / FAIL copy and explicit counts/details.
- “Ecosystem sync” stays **off by default**. If checked, “Create account” opens the existing auth flow with Fusion 360 and Onshape pre-checked as optional follow-ups.
- “Store + QoL” stays informational: Knowledge Store, Product Marketplace, and Tips & Tricks links are offered on first launch, with a plain-English reminder that theme/mouse/AI-key comfort settings live in the avatar menu after sign-in.

## Verification targets

- Clean KB state shows PASS on a fresh self-hosted/local browser launch.
- Dirty KB state shows a clear FAIL summary.
- Half-seeded KB state shows a clear FAIL summary.
- Dismissing the modal must not create a nag loop on the same host/browser.
