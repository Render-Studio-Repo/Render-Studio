"""SQLite database for users, teams, and project access."""

from __future__ import annotations

import json
import sqlite3
import base64
from pathlib import Path

from backend.config import settings

# Absolute path — never depend on process cwd (generation may chdir on a worker thread).
DB_PATH = (Path(settings.data_dir) / "render3d.db").resolve()


def get_conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
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

            CREATE TABLE IF NOT EXISTS project_shares (
                project_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                shared_by TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (project_id, user_id),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (shared_by) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS project_share_invites (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                email TEXT NOT NULL,
                invited_by TEXT NOT NULL,
                invite_token TEXT NOT NULL UNIQUE,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL,
                FOREIGN KEY (invited_by) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS project_hidden (
                project_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (project_id, user_id),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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

            CREATE TABLE IF NOT EXISTS knowledge_shares (
                id TEXT PRIMARY KEY,
                kb_id TEXT NOT NULL,
                share_type TEXT NOT NULL,
                target_id TEXT NOT NULL,
                shared_by TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(kb_id, share_type, target_id),
                FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS model_listings (
                id TEXT PRIMARY KEY,
                slug TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                tagline TEXT NOT NULL,
                description TEXT NOT NULL,
                body_md TEXT NOT NULL DEFAULT '',
                category TEXT NOT NULL DEFAULT 'models',
                thumbnail_json TEXT NOT NULL DEFAULT '',
                gallery_json TEXT NOT NULL DEFAULT '[]',
                files_json TEXT NOT NULL DEFAULT '[]',
                members_json TEXT NOT NULL DEFAULT '[]',
                license TEXT NOT NULL DEFAULT 'proprietary',
                access_mode TEXT NOT NULL DEFAULT 'free',
                download_enabled INTEGER NOT NULL DEFAULT 1,
                price_cents INTEGER NOT NULL DEFAULT 0,
                currency TEXT NOT NULL DEFAULT 'USD',
                status TEXT NOT NULL DEFAULT 'pending',
                featured INTEGER NOT NULL DEFAULT 0,
                boost_status TEXT NOT NULL DEFAULT 'none',
                boosted_until TEXT,
                created_by TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                published_at TEXT,
                FOREIGN KEY (created_by) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS marketplace_boost_apps (
                id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                listing_id TEXT NOT NULL,
                listing_slug TEXT,
                user_id TEXT NOT NULL,
                message TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL,
                reviewed_at TEXT,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS marketplace_seller_accounts (
                user_id TEXT PRIMARY KEY,
                stripe_account_id TEXT,
                charges_enabled INTEGER NOT NULL DEFAULT 0,
                payouts_enabled INTEGER NOT NULL DEFAULT 0,
                details_submitted INTEGER NOT NULL DEFAULT 0,
                paypal_email TEXT NOT NULL DEFAULT '',
                payout_method TEXT NOT NULL DEFAULT 'stripe',
                payout_details_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS marketplace_purchases (
                id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                listing_id TEXT NOT NULL,
                listing_slug TEXT,
                buyer_user_id TEXT NOT NULL,
                seller_user_id TEXT NOT NULL,
                price_cents INTEGER NOT NULL,
                platform_fee_cents INTEGER NOT NULL DEFAULT 0,
                seller_net_cents INTEGER NOT NULL DEFAULT 0,
                currency TEXT NOT NULL DEFAULT 'USD',
                stripe_session_id TEXT,
                stripe_payment_intent TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL,
                paid_at TEXT,
                FOREIGN KEY (buyer_user_id) REFERENCES users(id),
                FOREIGN KEY (seller_user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS ai_credit_accounts (
                user_id TEXT PRIMARY KEY,
                balance_cents INTEGER NOT NULL DEFAULT 0,
                auto_refill_enabled INTEGER NOT NULL DEFAULT 0,
                auto_refill_threshold_cents INTEGER NOT NULL DEFAULT 500,
                auto_refill_amount_cents INTEGER NOT NULL DEFAULT 2000,
                use_platform_key INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS ai_credit_transactions (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                amount_cents INTEGER NOT NULL,
                balance_after_cents INTEGER NOT NULL,
                provider TEXT NOT NULL DEFAULT '',
                model TEXT NOT NULL DEFAULT '',
                project_id TEXT,
                stripe_session_id TEXT,
                meta_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            """
        )
        for col_sql in (
            "ALTER TABLE agent_app_listings ADD COLUMN body_md TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE agent_app_listings ADD COLUMN license TEXT NOT NULL DEFAULT 'proprietary'",
            "ALTER TABLE agent_app_listings ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'free'",
            "ALTER TABLE agent_app_listings ADD COLUMN download_enabled INTEGER NOT NULL DEFAULT 1",
            "ALTER TABLE agent_app_listings ADD COLUMN members_json TEXT NOT NULL DEFAULT '[]'",
            "ALTER TABLE agent_app_listings ADD COLUMN boost_status TEXT NOT NULL DEFAULT 'none'",
            "ALTER TABLE agent_app_listings ADD COLUMN boosted_until TEXT",
        ):
            try:
                conn.execute(col_sql)
            except sqlite3.OperationalError:
                pass
        try:
            conn.execute("CREATE INDEX IF NOT EXISTS idx_model_listings_status ON model_listings(status, featured)")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("CREATE INDEX IF NOT EXISTS idx_marketplace_boost_status ON marketplace_boost_apps(status, kind)")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_marketplace_purchases_buyer ON marketplace_purchases(buyer_user_id, status)"
            )
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_marketplace_purchases_session ON marketplace_purchases(stripe_session_id)"
            )
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE marketplace_seller_accounts ADD COLUMN payout_details_json TEXT NOT NULL DEFAULT '{}'")
        except sqlite3.OperationalError:
            pass
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
            conn.execute("ALTER TABLE ai_credit_accounts ADD COLUMN platform_provider TEXT NOT NULL DEFAULT 'openai'")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE ai_credit_accounts ADD COLUMN platform_model TEXT NOT NULL DEFAULT ''")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE ai_credit_accounts ADD COLUMN trial_granted_at TEXT")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE ai_credit_accounts ADD COLUMN trial_popup_seen_at TEXT")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE ai_credit_accounts ADD COLUMN trial_email_sent_at TEXT")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE ai_credit_accounts ADD COLUMN trial_grant_ip TEXT")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS ai_credit_trial_ips (
                    ip TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    granted_at TEXT NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                )
                """
            )
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_ai_credit_trial_ips_user ON ai_credit_trial_ips(user_id)"
            )
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_ai_credit_transactions_user ON ai_credit_transactions(user_id, created_at DESC)"
            )
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE users ADD COLUMN avatar_url TEXT")
        except sqlite3.OperationalError:
            pass
        try:
            from backend.services.profile_service import migrate_user_handles

            migrate_user_handles(conn)
        except Exception:
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
            conn.execute("ALTER TABLE team_members ADD COLUMN can_invite INTEGER NOT NULL DEFAULT 0")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE team_members ADD COLUMN access TEXT NOT NULL DEFAULT 'edit'")
        except sqlite3.OperationalError:
            pass
        try:
            # Owners + managers can invite by default; regular users cannot until granted.
            conn.execute(
                """
                UPDATE team_members
                SET can_invite = 1
                WHERE lower(role) IN ('owner', 'admin', 'manager')
                """
            )
            conn.execute(
                """
                UPDATE team_members
                SET access = 'edit'
                WHERE access IS NULL OR trim(access) = ''
                """
            )
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
                "Simulate wiring diagrams, circuits, and photo-based wiring debug inside Render Studio.",
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

        def _model_thumb(title: str, accent: str, sub: str = "FREE") -> str:
            svg = f"""
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 760">
              <defs>
                <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
                  <stop offset="0" stop-color="#050914"/>
                  <stop offset="0.55" stop-color="#0d1727"/>
                  <stop offset="1" stop-color="#111827"/>
                </linearGradient>
                <linearGradient id="part" x1="0" x2="1">
                  <stop offset="0" stop-color="{accent}"/>
                  <stop offset="1" stop-color="#58a6ff"/>
                </linearGradient>
                <filter id="glow"><feGaussianBlur stdDeviation="10" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
              </defs>
              <rect width="1200" height="760" fill="url(#bg)"/>
              <g opacity=".34" stroke="#58a6ff" stroke-width="1">
                <path d="M0 520h1200M0 580h1200M0 640h1200M120 0v760M240 0v760M360 0v760M480 0v760M600 0v760M720 0v760M840 0v760M960 0v760M1080 0v760"/>
              </g>
              <circle cx="920" cy="118" r="210" fill="{accent}" opacity=".16"/>
              <circle cx="280" cy="620" r="260" fill="#58a6ff" opacity=".12"/>
              <g filter="url(#glow)" transform="translate(245 190)">
                <rect x="40" y="280" width="560" height="82" rx="28" fill="#111827" stroke="{accent}" stroke-width="8"/>
                <circle cx="150" cy="258" r="82" fill="#151923" stroke="{accent}" stroke-width="18"/>
                <rect x="190" y="115" width="310" height="70" rx="34" fill="url(#part)" transform="rotate(-22 190 115)"/>
                <circle cx="445" cy="116" r="58" fill="#151923" stroke="#ffedd5" stroke-width="12"/>
                <circle cx="445" cy="116" r="28" fill="{accent}"/>
                <rect x="432" y="108" width="235" height="22" rx="11" fill="#ffedd5" transform="rotate(-24 432 108)"/>
                <path d="M650 8l82 82M730 88l-86 62" stroke="#ffedd5" stroke-width="15" stroke-linecap="round"/>
                <circle cx="150" cy="258" r="42" fill="{accent}"/>
              </g>
              <text x="64" y="96" fill="#e6edf3" font-family="Inter, Arial, sans-serif" font-size="54" font-weight="800">{title}</text>
              <text x="66" y="146" fill="{accent}" font-family="Inter, Arial, sans-serif" font-size="28" font-weight="800" letter-spacing="4">{sub}</text>
            </svg>
            """
            encoded = base64.b64encode(svg.encode("utf-8")).decode("ascii")
            return f"data:image/svg+xml;base64,{encoded}"

        builtin_models = [
            {
                "id": "builtin-sam-robot-arm",
                "slug": "sam-robot-arm-assembly",
                "name": "Sam's Robot Arm Assembly",
                "tagline": "Public robot arm project with editable mechanical pieces and robotics-ready structure.",
                "description": "A free Render Studio robotics project listing for exploring arm joints, end-effectors, mounting plates, and component organization.",
                "body": "## Includes\n- Robot arm assembly concept\n- Component-friendly structure\n- Great starter for URDF, motion, and gripper experiments\n\nUse this as the public example robot arm project in the model marketplace.",
                "category": "Robotics",
                "license": "cc-by",
                "thumb": _model_thumb("Robot Arm Assembly", "#f97316", "PUBLIC FREE"),
                "files": ["robot_arm.glb", "robot_arm.step", "robot_arm.urdf"],
                "featured": 1,
            },
            {
                "id": "builtin-modular-room-kit",
                "slug": "modular-room-kit-free",
                "name": "Modular Room Kit",
                "tagline": "Snap-grid walls, window panels, door insert, and floor modules for Architect mode.",
                "description": "A free modular architecture starter kit with printable room parts and clear component naming.",
                "body": "## Includes\n- Wall panels and floor slab\n- Window and door inserts\n- Snap-style connector ideas\n\nDesigned for quick remixing in Architect mode.",
                "category": "Architecture",
                "license": "cc-by",
                "thumb": _model_thumb("Modular Room Kit", "#38bdf8", "FREE"),
                "files": ["modular_room.glb", "modular_room.step"],
                "featured": 1,
            },
            {
                "id": "builtin-gripper-toolheads",
                "slug": "robot-gripper-toolheads",
                "name": "Robot Gripper Toolheads",
                "tagline": "A free set of swappable gripper and cooking-tool concepts for robot arm testing.",
                "description": "End-effector examples for experimenting with robot arms, adapters, and tool changing.",
                "body": "## Includes\n- Parallel jaw gripper concept\n- Spatula/cooking-tool replacement ideas\n- Mounting adapter geometry notes",
                "category": "Robotics",
                "license": "cc0",
                "thumb": _model_thumb("Gripper Toolheads", "#22c55e", "FREE"),
                "files": ["gripper_toolheads.glb", "gripper_toolheads.step"],
                "featured": 0,
            },
            {
                "id": "builtin-fixture-clamp-set",
                "slug": "fixture-clamp-set-free",
                "name": "Fixture Clamp Set",
                "tagline": "Printable clamps, brackets, and jig blocks for holding parts during builds.",
                "description": "A practical free manufacturing starter set for fixtures, small assembly jigs, and bench testing.",
                "body": "## Includes\n- Clamp bodies\n- Bracket blocks\n- Simple fixture plates\n\nUseful for robotics and small CAD assembly workflows.",
                "category": "Manufacturing",
                "license": "cc-by-sa",
                "thumb": _model_thumb("Fixture Clamp Set", "#a855f7", "FREE"),
                "files": ["fixture_clamps.step", "fixture_clamps.3mf"],
                "featured": 0,
            },
            {
                "id": "builtin-drone-frame-mini",
                "slug": "mini-drone-frame-free",
                "name": "Mini Drone Frame",
                "tagline": "Lightweight free frame concept with motor pads and electronics bay.",
                "description": "A public mini drone frame concept for testing CAD workflows, exports, and marketplace downloads.",
                "body": "## Includes\n- Frame plate concept\n- Motor mount pads\n- Electronics bay placeholder\n\nFree public model for early Render Studio marketplace browsing.",
                "category": "Aerospace",
                "license": "cc-by-nc",
                "thumb": _model_thumb("Mini Drone Frame", "#f59e0b", "FREE"),
                "files": ["mini_drone_frame.glb", "mini_drone_frame.step"],
                "featured": 0,
            },
        ]
        for item in builtin_models:
            files_json = json.dumps(
                [
                    {"name": name, "size": 0, "media_type": "application/octet-stream", "builtin": True}
                    for name in item["files"]
                ],
                sort_keys=True,
            )
            conn.execute(
                """
                INSERT OR IGNORE INTO model_listings
                  (id, slug, name, tagline, description, body_md, category, thumbnail_json,
                   gallery_json, files_json, members_json, license, access_mode, download_enabled,
                   price_cents, currency, status, featured, boost_status, created_by, created_at,
                   updated_at, published_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    item["id"],
                    item["slug"],
                    item["name"],
                    item["tagline"],
                    item["description"],
                    item["body"],
                    item["category"],
                    json.dumps({"data_url": item["thumb"], "builtin": True}, sort_keys=True),
                    "[]",
                    files_json,
                    json.dumps([{"id": creator_id, "role": "owner", "display_name": "Sam W"}], sort_keys=True),
                    item["license"],
                    "free",
                    1,
                    0,
                    "USD",
                    "approved",
                    item["featured"],
                    "none",
                    creator_id,
                    now,
                    now,
                    now,
                ),
            )
            conn.execute(
                """
                UPDATE model_listings
                   SET status='approved', access_mode='free', price_cents=0, download_enabled=1,
                       featured=?, thumbnail_json=?, files_json=?, updated_at=?
                 WHERE id=?
                """,
                (
                    item["featured"],
                    json.dumps({"data_url": item["thumb"], "builtin": True}, sort_keys=True),
                    files_json,
                    now,
                    item["id"],
                ),
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
            -- If no row exists for a member, access is DENIED by default.
            -- granted=1 means the owner has explicitly allowed that member.
            -- Key owners always retain access even without a grant row.
            CREATE TABLE IF NOT EXISTS team_key_grants (
                key_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                granted INTEGER NOT NULL DEFAULT 0,
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

            -- Google / Apple / Microsoft identities linked to Render Studio users.
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
            -- If no row exists for a member, access is DENIED by default.
            -- granted=1 means the owner has explicitly allowed that member.
            -- Key owners always retain access even without a grant row.
            CREATE TABLE IF NOT EXISTS team_key_grants (
                key_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                granted INTEGER NOT NULL DEFAULT 0,
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
            conn.execute("ALTER TABLE user_team_key_opts ADD COLUMN allowed_models TEXT")
        except sqlite3.OperationalError:
            pass
        # Preserve prior implicit access (old default was grant-on-missing-row), then
        # new teammates are inserted with granted=0 going forward.
        try:
            conn.execute(
                """
                INSERT OR IGNORE INTO team_key_grants (key_id, user_id, granted, updated_by, updated_at)
                SELECT k.id, tm.user_id, 1, k.shared_by, datetime('now')
                FROM team_shared_ai_keys k
                JOIN team_members tm ON tm.team_id = k.team_id
                LEFT JOIN team_key_grants g ON g.key_id = k.id AND g.user_id = tm.user_id
                WHERE g.key_id IS NULL
                  AND tm.user_id != k.shared_by
                """
            )
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
