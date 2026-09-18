#!/usr/bin/env bash
set -euo pipefail

OWNER="${OWNER:-wprojects}"
REPO="${REPO:-Render-Studio}"
BREAK_GLASS_USER="${BREAK_GLASS_USER:-wprojects}"
CHECK_CONTEXT="${CHECK_CONTEXT:-pr-guard}"

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required." >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "gh CLI is not authenticated." >&2
  exit 1
fi

apply_branch_protection() {
  local branch="$1"

  if ! gh api "repos/$OWNER/$REPO/branches/$branch" >/dev/null 2>&1; then
    echo "Skipping missing branch: $branch"
    return 0
  fi

  echo "Applying classic branch protection to $branch"

  gh api \
    --method PUT \
    -H "Accept: application/vnd.github+json" \
    "repos/$OWNER/$REPO/branches/$branch/protection" \
    --input - <<JSON
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["$CHECK_CONTEXT"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 1
  },
  "restrictions": {
    "users": ["$BREAK_GLASS_USER"],
    "teams": [],
    "apps": []
  },
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
JSON
}

apply_branch_protection "master"
apply_branch_protection "main"

echo "Classic branch protection apply attempt complete."
