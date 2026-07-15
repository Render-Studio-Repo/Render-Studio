from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT_DIR / ".env"


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
    openai_model: str = "gpt-5.5"
    openai_model_quality: str = "gpt-5.5-pro"
    openai_reasoning_effort: str = "low"
    anthropic_model: str = "claude-sonnet-4-5"
    host: str = "127.0.0.1"
    port: int = 8000
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
    onshape_redirect_uri: str = "https://smartcallusa.com/oauth/callback"

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

    # Capacity collapse alerts (Gmail SMTP → ops inbox)
    capacity_alert_smtp_host: str = "smtp.gmail.com"
    capacity_alert_smtp_port: int = 587
    capacity_alert_smtp_user: str = ""  # e.g. info@render3d.app
    capacity_alert_smtp_password: str = ""  # Gmail App Password
    capacity_alert_from: str = "info@render3d.app"
    capacity_alert_to: str = "sam@render3d.app"

    # Marketplace payments (Stripe Connect + Link)
    stripe_secret_key: str = ""
    stripe_publishable_key: str = ""
    stripe_webhook_secret: str = ""
    marketplace_platform_fee_bps: int = 1000  # 10%
    public_base_url: str = "https://render3d.app"

    # Discord product-update announcements
    discord_bot_token: str = ""
    discord_updates_channel_id: str = ""
    discord_public_models_channel_id: str = ""
    discord_application_id: str = ""
    discord_client_id: str = ""
    discord_client_secret: str = ""
    discord_redirect_uri: str = "https://render3d.app/oauth/discord/callback"
    discord_updates_webhook_url: str = ""

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


settings = Settings()
