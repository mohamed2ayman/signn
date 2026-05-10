"""Smoke test — verifies pytest is wired correctly and FastAPI is importable.

Uses TestClient directly (NOT as a context manager) so the lifespan handler
never fires and Base.metadata.create_all() never attempts a PostgreSQL
connection.
"""

from fastapi.testclient import TestClient

from main import app

# Module-level client — lifespan is NOT triggered here
client = TestClient(app)


def test_health_check():
    """GET /health returns 200 with status=healthy."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["service"] == "sign-ai-backend"
