from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT_DIR / ".env"
DEFAULT_OPENAI_MODEL = "gpt-6-astra"


def _absolute_under_root(value: str) -> str:
    """Resolve relative data/project dirs against the repo root.

    Generation can ``os.chdir`` into a project folder on a worker thread. Relative
    paths like ``data/render3d.db`` then briefly point at the wrong place and break
    login (``no such table: users``). Always keep these absolute.
    """
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = ROOT_DIR / path
    return str(path.resolve())


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ENV_FILE),
        env_file_encoding="utf-8",
        extra="ignore",
        env_ignore_empty=True,
    )

    openai_api_key: str = ""
    openai_model: str = DEFAULT_OPENAI_MODEL
    openai_model_quality: str = DEFAULT_OPENAI_MODEL
    openai_reasoning_effort: str = "low"
    # Comma-separated emails that use the shared server OPENAI_API_KEY
    openai_owner_emails: str = ""
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-4-5"
    anthropic_model_quality: str = "claude-opus-4-8"
    # BYOK OpenAI-compatible providers (optional platform keys unused unless set).
    kimi_api_key: str = ""
    kimi_model: str = "kimi-k2.6"
    kimi_model_quality: str = "kimi-k3"
    xai_api_key: str = ""
    xai_model: str = "grok-4.5"
    xai_model_quality: str = "grok-4.5"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.8-flash"
    qwen_api_key: str = ""
    qwen_model: str = "qwen3-coder-plus"
    host: str = "127.0.0.1"
    port: int = 8001
    projects_dir: str = "projects"
    data_dir: str = "data"
    jwt_secret: str = "change-me-in-production-render3d"
    jwt_expire_hours: int = 168

    @field_validator("projects_dir", "data_dir", mode="after")
    @classmethod
    def _abs_dirs(cls, value: str) -> str:
        return _absolute_under_root(value)

    # Onshape OAuth
    onshape_client_id: str = ""
    onshape_client_secret: str = ""
    onshape_redirect_uri: str = "https://render3d.app/oauth/callback"

    # Autodesk / Fusion 360 OAuth
    autodesk_client_id: str = ""
    autodesk_client_secret: str = ""
    autodesk_redirect_uri: str = "https://render3d.app/oauth/autodesk/callback"
    autodesk_scopes: str = "data:read data:write data:create viewables:read"

    # Social sign-in (Google / Apple / Microsoft)
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "https://render3d.app/oauth/google/callback"
    microsoft_client_id: str = ""
    microsoft_client_secret: str = ""
    microsoft_redirect_uri: str = "https://render3d.app/oauth/microsoft/callback"
    apple_client_id: str = ""
    apple_client_secret: str = ""
    apple_redirect_uri: str = "https://render3d.app/oauth/apple/callback"
    apple_team_id: str = ""
    apple_key_id: str = ""
    apple_private_key: str = ""

    # Capacity collapse alerts (Gmail SMTP → ops inbox). Disabled by default.
    capacity_alert_enabled: bool = False
    capacity_alert_smtp_host: str = "smtp.gmail.com"
    capacity_alert_smtp_port: int = 587
    capacity_alert_smtp_user: str = ""  # e.g. info@render3d.app
    capacity_alert_smtp_password: str = ""  # Gmail App Password
    capacity_alert_from: str = "info@render3d.app"
    capacity_alert_to: str = ""

    # Supabase — server-only. Secret / service_role / PAT never ship to the browser.
    supabase_url: str = ""
    supabase_publishable_key: str = ""
    supabase_secret_key: str = ""
    supabase_key: str = ""  # REST alias (service_role JWT or sb_secret)
    supabase_service_role_key: str = ""  # JWT, server only
    supabase_access_token: str = ""  # Management PAT (sbp_…), not for REST
    # local = sqlite users/passwords/keys (old method). supabase / blank = remote when URL+role set.
    users_backend: str = ""
    # Optional DSN for your own Postgres tooling. This app does not auto-map Users onto it.
    database_url: str = ""
    # Dedicated key for encrypting user BYOK at rest (Fernet). Prefer over jwt_secret.
    secrets_fernet_key: str = ""

    # Marketplace payments (Stripe Connect + Link)
    stripe_secret_key: str = ""
    stripe_publishable_key: str = ""
    stripe_webhook_secret: str = ""
    # Prefer dynamic Checkout Sessions when Stripe secret is set. Leave blank unless
    # you intentionally use a fixed Payment Link.
    stripe_ai_credits_payment_link_url: str = ""
    stripe_ai_credits_payment_link_id: str = ""
    marketplace_platform_fee_bps: int = 1000  # 10%
    public_base_url: str = ""
    grok_mcp_token: str = ""
    grok_mcp_url: str = "https://render3d.app/mcp"
    grok_music_api_key: str = ""
    grok_music_library_dir: str = "Marketing/Music/library"
    prompt_trace_api_key: str = ""
    marketplace_hub_url: str = "https://render3d.app"
    marketplace_hub_token: str = ""
    # AutoPrep (autoprep.render3d.app) proxies LLM calls to this Studio process.
    health_studio_service_token: str = ""
    health_studio_owner_user_id: str = ""
    # PayPal Login with PayPal (receive-money / Authorized apps). No fake connect without these.
    paypal_client_id: str = ""
    paypal_client_secret: str = ""
    paypal_mode: str = "live"
    paypal_redirect_uri: str = "https://render3d.app/oauth/paypal/callback"

    # Discord product-update announcements
    discord_bot_token: str = ""
    discord_updates_channel_id: str = "1512906649822560508"
    discord_public_models_channel_id: str = ""
    discord_application_id: str = "1527052867742076958"
    discord_client_id: str = "1527052867742076958"
    discord_client_secret: str = ""
    discord_redirect_uri: str = "https://render3d.app/oauth/discord/callback"
    discord_updates_webhook_url: str = ""

    # X (Twitter) — per-user OAuth for Share to X from viewport video
    # Default oauth1 uses API Key + API Key Secret (Keys and tokens).
    # Set TWITTER_OAUTH_MODE=oauth2 when using OAuth 2.0 Client ID + Client Secret.
    twitter_client_id: str = ""
    twitter_client_secret: str = ""
    twitter_redirect_uri: str = "https://render3d.app/oauth/twitter/callback"
    twitter_oauth_mode: str = "auto"
    twitter_bearer_token: str = ""
    twitter_access_token: str = ""
    twitter_access_token_secret: str = ""
    # Optional aliases for the same X developer app (Grok bot / Account Activity).
    x_consumer_key: str = ""
    x_consumer_secret: str = ""
    x_webhook_path: str = "/api/webhooks/x"
    x_webhook_env: str = ""
    x_webhook_auto_reply: bool = False

    # GitHub authorized-app link (Foundry). Not a second login identity.
    github_client_id: str = ""
    github_client_secret: str = ""
    github_redirect_uri: str = "https://render3d.app/oauth/github/callback"
    github_token: str = ""
    github_bugs_repo: str = ""
    github_bugs_branch: str = "bugs"

    twitch_client_id: str = ""
    twitch_client_secret: str = ""
    kick_client_id: str = ""
    kick_client_secret: str = ""

    # LinkedIn product-update announcements (member or organization URN)
    linkedin_client_id: str = ""
    linkedin_client_secret: str = ""
    linkedin_access_token: str = ""
    linkedin_author_urn: str = ""
    linkedin_enabled: bool = True
    linkedin_schedule_name: str = "Sam's posts"
    linkedin_schedule_timezone: str = "America/New_York"
    linkedin_schedule_weekday_hours: str = "10"
    linkedin_schedule_sunday_hours: str = "10,16"
    linkedin_schedule_recent_window: int = 10

    # WebRTC ICE for Quest voice. Empty = Google STUN only. No vendor signup.
    xr_ice_servers_json: str = ""
    xr_turn_urls: str = ""
    xr_turn_username: str = ""
    xr_turn_credential: str = ""

    # Local Bambu LAN (gitignored .env only — never commit the access code).
    bambu_printer_host: str = ""
    bambu_printer_access_code: str = ""
    bambu_printer_serial: str = ""
    bambu_printer_name: str = ""

    # Optional scp of incident PDFs to a MacBook Downloads folder.
    incident_export_ssh: str = ""
    incident_export_ssh_dir: str = "Downloads"


settings = Settings()

# CAD generate / Improve-with-AI: production specs (OpenArm-scale) routinely exceed 8k.
# Chat, wiring, and render-agent messages stay at 8k on those request models.
CAD_PROMPT_MAX_CHARS = 100_000
