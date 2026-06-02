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

    # ── Text extraction backend ──────────────────────────────────────────────
    # "tesseract" (default) or "textract" (requires S3 — see Phase 9.1c).
    TEXT_EXTRACTOR: str = "tesseract"

    # ── AWS / S3 (optional — used by Textract backend and S3 storage adapter)
    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""
    AWS_REGION: str = "us-east-1"
    AWS_S3_BUCKET: str = ""

    # ── Scan quality detection thresholds (Phase 7.25) ──────────────────────
    # Laplacian variance below this value signals a blurry scan.
    BLUR_THRESHOLD: float = 50.0
    # PIL ImageStat stddev below this value signals a low-contrast scan.
    CONTRAST_THRESHOLD: float = 20.0
    # Rotation (degrees) at or above this value signals a skewed scan.
    ROTATION_THRESHOLD: float = 10.0

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
    )


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings instance (singleton)."""
    return Settings()
