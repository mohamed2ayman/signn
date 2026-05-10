import pytest
from app.config.settings import get_settings


@pytest.fixture(autouse=True)
def clear_settings_cache():
    """Clear the lru_cache on get_settings before and after every test.

    Prevents cached settings from one test leaking into another,
    which is especially important when env vars differ between tests.
    """
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
