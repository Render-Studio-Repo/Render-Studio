# Workshop Weekly Goals mirror

This wall panel reads a **read-only mirror file**:

- Mirror path: `sandbox-sessions/workshop/weekly-goals/latest.json`
- UI surfaces: Workshop desktop `Project -> Weekly Goals` and Workshop `God Mode`

## Week window

- Time zone: `America/Chicago`
- Week shape: Monday through Sunday
- `week_id` format: `YYYY-Www` using the Chicago-local ISO week

Example:

- Friday `2026-09-18` in Chicago falls in `2026-W38`

## Refreshing `latest.json` from CURRENT

1. Export or copy the CURRENT weekly-goals payload from the PM source of truth.
2. Ensure it matches this schema exactly:

```json
{
  "week_id": "2026-W38",
  "updated_at": "2026-09-18T06:00:00Z",
  "source": "current",
  "goals": [
    {
      "id": "g-1",
      "title": "string",
      "owner_slug": "string",
      "status": "todo|doing|done|blocked",
      "claim_id": "optional"
    }
  ]
}
```

3. Overwrite `sandbox-sessions/workshop/weekly-goals/latest.json`.
4. Re-open Workshop or revisit the Weekly Goals panel to read the refreshed mirror.

## v1 guardrails

- The UI is read-only by default.
- There is no write-back to CURRENT in this version.
- Do not add auto-posts, engagement meters, scores, or dollar summaries here.
