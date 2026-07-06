from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT_DIR / ".env"


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
    host: str = "127.0.0.1"
    port: int = 8000
    projects_dir: str = "projects"
    data_dir: str = "data"
    jwt_secret: str = ""
    jwt_expire_hours: int = 168


settings = Settings()
