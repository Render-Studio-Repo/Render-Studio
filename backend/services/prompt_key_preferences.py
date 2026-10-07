"""Account-scoped default for the Studio prompt key picker."""
from backend.database import get_conn


def default_for_user(user):
    return ""


def _ensure_table(conn):
    conn.execute("CREATE TABLE IF NOT EXISTS prompt_key_preferences (user_id TEXT PRIMARY KEY, pinned_key TEXT NOT NULL)")


def get_pinned_key(user):
    with get_conn() as conn:
        _ensure_table(conn)
        row = conn.execute("SELECT pinned_key FROM prompt_key_preferences WHERE user_id = ?", (user["id"],)).fetchone()
    return row["pinned_key"] if row else default_for_user(user)


def set_pinned_key(user, value):
    # This control pins the ChatGPT subscription; it never stores credentials.
    if value not in ("", "chatgpt:subscription"):
        raise ValueError("Choose ChatGPT subscription or unpin the default")
    with get_conn() as conn:
        _ensure_table(conn)
        conn.execute("INSERT INTO prompt_key_preferences (user_id, pinned_key) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET pinned_key = excluded.pinned_key", (user["id"], value))
    return value
