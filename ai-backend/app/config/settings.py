"""Application settings loaded from environment variables."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """SIGN Platform AI Backend configuration.

    All values are loaded from environment variables or the .env file
    located at the ai-backend root directory.
    """

    # AI Provider API Keys
    ANTHROPIC_API_KEY: str = ""
    OPENAI_API_KEY: str = ""

    # Database
    DATABASE_URL: str = "postgresql://postgres:postgres@localhost:5432/sign_platform"

    # Redis / Celery broker
    REDIS_URL: str = "redis://localhost:6379/0"

    # NestJS backend communication
    NESTJS_API_URL: str = "http://localhost:3000"
    NESTJS_INTERNAL_TOKEN: str = ""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
    )


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings instance (singleton)."""
    return Settings()
