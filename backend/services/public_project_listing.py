"""Merge public visibility into an owner's existing project listing."""
def merge_public_projects(projects, public_projects, user_id):
    existing = {p["id"]: p for p in projects}
    public_ids = {p["id"] for p in public_projects}
    result = [p for p in projects if p.get("id") not in public_ids]
    for public in public_projects:
        personal = existing.get(public["id"])
        if personal and str(public.get("owner_user_id") or "") == str(user_id):
            result.append({**public, **personal, "public": True,
                           "public_pinned": bool(public.get("public_pinned"))})
        else:
            result.append(public)
    return result
