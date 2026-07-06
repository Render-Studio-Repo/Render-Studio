"""SQLite database for users, teams, and project access."""

from __future__ import annotations

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
                created_by TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
                FOREIGN KEY (folder_id) REFERENCES workspace_folders(id) ON DELETE SET NULL,
                FOREIGN KEY (created_by) REFERENCES users(id)
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
            """
        )
        try:
            conn.execute("ALTER TABLE project_access ADD COLUMN folder_id TEXT")
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
