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
    # Single source of truth for the Claude model id used by ALL agents
    # (Phase 8.1 centralization). Override via the ANTHROPIC_MODEL env var.
    # NOTE: changing this model requires running the Arabic accuracy suite
    # first (ai-backend/tests/accuracy/) — never swap the model blind.
    ANTHROPIC_MODEL: str = "claude-sonnet-4-6"
    # Cheaper model for the bounded party-extraction fallback (regex-first; this
    # fires only when the backend regex yields < 2 parties from a preamble
    # window). A short single-preamble classification does not need Sonnet.
    # Override via the PARTY_EXTRACT_MODEL env var. This is a separate, small,
    # non-Arabic-critical path — NOT gated by the Arabic clause-extraction
    # accuracy suite (that gate protects ANTHROPIC_MODEL / clause extraction).
    PARTY_EXTRACT_MODEL: str = "claude-haiku-4-5-20251001"
    OPENAI_API_KEY: str = ""

    # Max number of chunk-extraction Anthropic calls issued CONCURRENTLY for a
    # single large document (the chunked clause-extraction path). Default 3 is a
    # safe floor that respects typical account rate limits. NOTE: the rate-limit
    # budget is SHARED across the Celery worker processes (--concurrency), so the
    # platform-wide worst case is (celery concurrency) × this value — size
    # accordingly. The agent also reads the live anthropic-ratelimit-* response
    # headers and pauses if the window is nearly spent, so raising this is safe
    # but should be tuned against the account's Anthropic usage tier.
    CLAUSE_EXTRACT_CONCURRENCY: int = 3

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
