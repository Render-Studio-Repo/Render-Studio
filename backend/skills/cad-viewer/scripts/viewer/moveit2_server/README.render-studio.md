# Canonical MoveIt2 for Render Studio

This skill ships a **bundled copy** of the MoveIt2 WebSocket helper for offline skill packaging.

When developing against a full Render Studio checkout, prefer the shared integration:

**[`integrations/moveit2/`](../../../../../../integrations/moveit2/)**

```bash
bash integrations/moveit2/run-moveit2-server.sh
# or
scripts/run-moveit2-for-project.sh <project_id>
```

Keep paths repo-relative (`RENDER_STUDIO_ROOT` / `MOVEIT2_SERVER_REPO_ROOT`). Do not hard-code `/home/ubuntu` or `/Users/...`.
