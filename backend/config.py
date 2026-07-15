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


settings = Settings()
