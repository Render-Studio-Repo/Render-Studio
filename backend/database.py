"""SQLite database for users, teams, and project access."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from backend.config import settings

DB_PATH = Path(settings.data_dir) / "render3d.db"


def get_conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with get_conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                display_name TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS teams (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (created_by) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS team_members (
                team_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'member',
                joined_at TEXT NOT NULL,
                PRIMARY KEY (team_id, user_id),
                FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS team_invites (
                id TEXT PRIMARY KEY,
                team_id TEXT NOT NULL,
                email TEXT NOT NULL,
                invited_by TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL,
                FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
                FOREIGN KEY (invited_by) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS workspace_folders (
                id TEXT PRIMARY KEY,
                team_id TEXT NOT NULL,
                parent_id TEXT,
                name TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                visibility TEXT NOT NULL DEFAULT 'workspace',
                created_by TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
                FOREIGN KEY (parent_id) REFERENCES workspace_folders(id) ON DELETE CASCADE,
                FOREIGN KEY (created_by) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS folder_shares (
                folder_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                shared_by TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (folder_id, user_id),
                FOREIGN KEY (folder_id) REFERENCES workspace_folders(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (shared_by) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS folder_share_invites (
                id TEXT PRIMARY KEY,
                folder_id TEXT NOT NULL,
                email TEXT NOT NULL,
                invited_by TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL,
                FOREIGN KEY (folder_id) REFERENCES workspace_folders(id) ON DELETE CASCADE,
                FOREIGN KEY (invited_by) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS project_access (
                project_id TEXT PRIMARY KEY,
                team_id TEXT NOT NULL,
                folder_id TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_by TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
                FOREIGN KEY (folder_id) REFERENCES workspace_folders(id) ON DELETE SET NULL,
                FOREIGN KEY (created_by) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS project_fusion_mirrors (
                project_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                team_id TEXT,
                hub_id TEXT NOT NULL,
                hub_label TEXT,
                aps_project_id TEXT NOT NULL,
                aps_project_label TEXT,
                folder_id TEXT NOT NULL,
                folder_label TEXT,
                last_item_id TEXT,
                last_version_id TEXT,
                last_pushed_at TEXT,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (project_id, user_id),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS workspace_activity (
                id TEXT PRIMARY KEY,
                team_id TEXT NOT NULL,
                project_id TEXT,
                kind TEXT NOT NULL,
                label TEXT NOT NULL,
                user_id TEXT,
                user_name TEXT,
                meta TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS agent_app_listings (
                id TEXT PRIMARY KEY,
                slug TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                tagline TEXT NOT NULL,
                description TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT 'agent',
                app_type TEXT NOT NULL DEFAULT 'skill',
                manifest_json TEXT NOT NULL DEFAULT '{}',
                source_url TEXT,
                icon_url TEXT,
                price_cents INTEGER NOT NULL DEFAULT 0,
                currency TEXT NOT NULL DEFAULT 'USD',
                premium INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'pending',
                featured INTEGER NOT NULL DEFAULT 0,
                created_by TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                published_at TEXT,
                FOREIGN KEY (created_by) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS agent_app_installs (
                user_id TEXT NOT NULL,
                app_id TEXT NOT NULL,
                installed_at TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'installed',
                PRIMARY KEY (user_id, app_id),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (app_id) REFERENCES agent_app_listings(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS knowledge_bases (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS knowledge_folders (
                id TEXT PRIMARY KEY,
                kb_id TEXT NOT NULL,
                parent_id TEXT,
                name TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE,
                FOREIGN KEY (parent_id) REFERENCES knowledge_folders(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS knowledge_items (
                id TEXT PRIMARY KEY,
                kb_id TEXT NOT NULL,
                folder_id TEXT,
                name TEXT NOT NULL,
                media_type TEXT NOT NULL DEFAULT 'application/octet-stream',
                storage_path TEXT NOT NULL,
                text_excerpt TEXT NOT NULL DEFAULT '',
                size_bytes INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE,
                FOREIGN KEY (folder_id) REFERENCES knowledge_folders(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS knowledge_skill_links (
                kb_id TEXT NOT NULL,
                skill_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (kb_id, skill_id),
                FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE
            );
            """
        )
        try:
            conn.execute("ALTER TABLE user_team_key_opts ADD COLUMN model TEXT")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE user_team_key_opts ADD COLUMN daily_limit_usd REAL")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE project_access ADD COLUMN folder_id TEXT")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE project_access ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE project_access ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute(
                "ALTER TABLE workspace_folders ADD COLUMN visibility TEXT NOT NULL DEFAULT 'workspace'"
            )
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE users ADD COLUMN ai_provider TEXT NOT NULL DEFAULT 'openai'")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE users ADD COLUMN ai_api_key_enc TEXT")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE users ADD COLUMN ai_model TEXT")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE users ADD COLUMN avatar_url TEXT")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE teams ADD COLUMN render_folder_provider TEXT NOT NULL DEFAULT 'render3d'")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE teams ADD COLUMN render_folder_ref TEXT")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE teams ADD COLUMN render_folder_label TEXT")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE teams ADD COLUMN render_folder_connected_at TEXT")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("CREATE INDEX IF NOT EXISTS idx_agent_app_status_featured ON agent_app_listings(status, featured)")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("CREATE INDEX IF NOT EXISTS idx_agent_app_created_by ON agent_app_listings(created_by)")
        except sqlite3.OperationalError:
            pass
        now = "2026-06-30T00:00:00+00:00"
        creator = conn.execute(
            """
            SELECT id FROM users
             WHERE lower(display_name) = 'sam w'
                OR lower(email) = 'a1projects@protonmail.com'
             ORDER BY CASE WHEN lower(display_name) = 'sam w' THEN 0 ELSE 1 END
             LIMIT 1
            """
        ).fetchone()
        creator_id = creator["id"] if creator else "sam-w-marketplace"
        if not creator:
            conn.execute(
                """
                INSERT OR IGNORE INTO users (id, email, display_name, password_hash, created_at, avatar_url)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    creator_id,
                    "samw@render3d.local",
                    "Sam W",
                    "marketplace-profile-only",
                    now,
                    None,
                ),
            )
        conn.execute(
            """
            INSERT OR IGNORE INTO agent_app_listings
              (id, slug, name, tagline, description, category, app_type, manifest_json,
               source_url, icon_url, price_cents, currency, premium, status, featured,
               created_by, created_at, updated_at, published_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                "builtin-silicone-mold",
                "silicone-mold-generation",
                "Silicone Mold Generation",
                "Turn selected CAD parts into clip-together silicone mold tooling.",
                (
                    "Generate reverse cavities, mold halves, registration pins, vents, sprues, "
                    "and clip-together closing features for silicone casting workflows."
                ),
                "Mold Making",
                "skill",
                json.dumps(
                    {
                        "skill_id": "silicone-mold-generation",
                        "entrypoint": "SKILL.md",
                        "permissions": ["project:read", "cad:generate"],
                        "supports_assets": True,
                        "asset_types": ["image/png", "image/jpeg", "image/webp", "text/markdown", "text/plain", "application/pdf"],
                        "outputs": ["mold_half_a", "mold_half_b", "sprue", "vents"],
                    },
                    sort_keys=True,
                ),
                None,
                None,
                0,
                "USD",
                0,
                "approved",
                1,
                creator_id,
                now,
                now,
                now,
            ),
        )
        conn.execute(
            """
            UPDATE agent_app_listings
               SET manifest_json = ?, created_by = COALESCE(created_by, ?), status = 'approved', featured = 1, updated_at = ?
             WHERE id = 'builtin-silicone-mold'
            """,
            (
                json.dumps(
                    {
                        "skill_id": "silicone-mold-generation",
                        "entrypoint": "SKILL.md",
                        "permissions": ["project:read", "cad:generate"],
                        "supports_assets": True,
                        "asset_types": ["image/png", "image/jpeg", "image/webp", "text/markdown", "text/plain", "application/pdf"],
                        "outputs": ["mold_half_a", "mold_half_b", "sprue", "vents"],
                    },
                    sort_keys=True,
                ),
                creator_id,
                now,
            ),
        )
        conn.execute(
            """
            INSERT OR IGNORE INTO agent_app_listings
              (id, slug, name, tagline, description, category, app_type, manifest_json,
               source_url, icon_url, price_cents, currency, premium, status, featured,
               created_by, created_at, updated_at, published_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                "builtin-wiring-simulator",
                "wiring-simulator",
                "Wiring Simulator",
                "Simulate wiring diagrams, circuits, and photo-based wiring debug inside Render3D.",
                (
                    "Use the wiring agent tools to lay out circuits, run interactive simulations, "
                    "debug wiring from photos, and generate Arduino-style hookup guidance."
                ),
                "Automation",
                "tool",
                json.dumps(
                    {
                        "skill_id": "wiring",
                        "entrypoint": "backend/skills/wiring/SKILL.md",
                        "permissions": ["project:read", "wiring:simulate", "wiring:debug"],
                        "tools": ["wiring-sim-engine", "wiring-photo-debug", "wiring-code-ui"],
                        "outputs": ["wiring.json", "simulation_trace", "debug_report"],
                    },
                    sort_keys=True,
                ),
                None,
                None,
                0,
                "USD",
                0,
                "approved",
                1,
                creator_id,
                now,
                now,
                now,
            ),
        )
        conn.execute(
            """
            UPDATE agent_app_listings
               SET created_by = COALESCE(created_by, ?), status = 'approved', featured = 1, updated_at = ?
             WHERE id = 'builtin-wiring-simulator'
            """,
            (creator_id, now),
        )

        # Team-shared AI keys — owner adds encrypted key, members see name/model only
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS team_shared_ai_keys (
                id TEXT PRIMARY KEY,
                team_id TEXT NOT NULL,
                name TEXT NOT NULL,
                provider TEXT NOT NULL,
                api_key_enc TEXT NOT NULL,
                model TEXT NOT NULL,
                shared_by TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
                FOREIGN KEY (shared_by) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS user_team_key_opts (
                user_id TEXT NOT NULL,
                key_id TEXT NOT NULL,
                use_key INTEGER NOT NULL DEFAULT 1,
                model TEXT,
                daily_limit_usd REAL,
                PRIMARY KEY (user_id, key_id),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (key_id) REFERENCES team_shared_ai_keys(id) ON DELETE CASCADE
            );

            -- Owner-controlled per-member access grants.
            -- If no row exists for a member, access is GRANTED by default.
            -- granted=0 means the owner has explicitly blocked that member.
            CREATE TABLE IF NOT EXISTS team_key_grants (
                key_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                granted INTEGER NOT NULL DEFAULT 1,
                updated_by TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (key_id, user_id),
                FOREIGN KEY (key_id) REFERENCES team_shared_ai_keys(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            -- Onshape OAuth tokens (one row per user)
            CREATE TABLE IF NOT EXISTS onshape_tokens (
                user_id TEXT PRIMARY KEY,
                access_token TEXT NOT NULL,
                refresh_token TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                onshape_user_id TEXT,
                onshape_email TEXT,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            -- Autodesk/Fusion OAuth tokens (one row per user)
            CREATE TABLE IF NOT EXISTS autodesk_tokens (
                user_id TEXT PRIMARY KEY,
                access_token TEXT NOT NULL,
                refresh_token TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                autodesk_user_id TEXT,
                autodesk_email TEXT,
                autodesk_name TEXT,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            -- Short-lived OAuth state tokens (CSRF protection)
            CREATE TABLE IF NOT EXISTS oauth_state (
                state TEXT PRIMARY KEY,
                user_id TEXT,
                created_at TEXT NOT NULL
            );

            -- Google / Apple / Microsoft identities linked to Render3D users.
            CREATE TABLE IF NOT EXISTS social_accounts (
                provider TEXT NOT NULL,
                provider_user_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                email TEXT,
                display_name TEXT,
                picture_url TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (provider, provider_user_id),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            """
        )
        try:
            conn.execute("ALTER TABLE users ADD COLUMN openai_api_key_enc TEXT")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE users ADD COLUMN openai_api_key_enc TEXT")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute(
                "ALTER TABLE workspace_folders ADD COLUMN visibility TEXT NOT NULL DEFAULT 'workspace'"
            )
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE users ADD COLUMN ai_provider TEXT NOT NULL DEFAULT 'openai'")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE users ADD COLUMN ai_api_key_enc TEXT")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE users ADD COLUMN ai_model TEXT")
        except sqlite3.OperationalError:
            pass

        # Team-shared AI keys — owner adds encrypted key, members see name/model only
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS team_shared_ai_keys (
                id TEXT PRIMARY KEY,
                team_id TEXT NOT NULL,
                name TEXT NOT NULL,
                provider TEXT NOT NULL,
                api_key_enc TEXT NOT NULL,
                model TEXT NOT NULL,
                shared_by TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
                FOREIGN KEY (shared_by) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS user_team_key_opts (
                user_id TEXT NOT NULL,
                key_id TEXT NOT NULL,
                use_key INTEGER NOT NULL DEFAULT 1,
                model TEXT,
                daily_limit_usd REAL,
                daily_token_limit INTEGER,
                PRIMARY KEY (user_id, key_id),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (key_id) REFERENCES team_shared_ai_keys(id) ON DELETE CASCADE
            );

            -- Owner-controlled per-member access grants.
            -- If no row exists for a member, access is GRANTED by default.
            -- granted=0 means the owner has explicitly blocked that member.
            CREATE TABLE IF NOT EXISTS team_key_grants (
                key_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                granted INTEGER NOT NULL DEFAULT 1,
                updated_by TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (key_id, user_id),
                FOREIGN KEY (key_id) REFERENCES team_shared_ai_keys(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            -- Onshape OAuth tokens (one row per user)
            CREATE TABLE IF NOT EXISTS onshape_tokens (
                user_id TEXT PRIMARY KEY,
                access_token TEXT NOT NULL,
                refresh_token TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                onshape_user_id TEXT,
                onshape_email TEXT,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            -- Short-lived OAuth state tokens (CSRF protection)
            CREATE TABLE IF NOT EXISTS oauth_state (
                state TEXT PRIMARY KEY,
                user_id TEXT,
                created_at TEXT NOT NULL
            );
            """
        )
        try:
            conn.execute("ALTER TABLE user_team_key_opts ADD COLUMN model TEXT")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE user_team_key_opts ADD COLUMN daily_limit_usd REAL")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE user_team_key_opts ADD COLUMN daily_token_limit INTEGER")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE team_shared_ai_keys ADD COLUMN scope_type TEXT NOT NULL DEFAULT 'all'")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE team_shared_ai_keys ADD COLUMN scope_project_id TEXT")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE team_shared_ai_keys ADD COLUMN scope_label TEXT")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE oauth_state ADD COLUMN redirect_uri TEXT")
        except sqlite3.OperationalError:
            pass
