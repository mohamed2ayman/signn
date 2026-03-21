"""SIGN Platform AI Backend - Main Application Entry Point."""

from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config.database import engine, Base
from app.config.settings import get_settings
from app.routers import agents, embeddings


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan handler for startup and shutdown events."""
    settings = get_settings()
    # Initialize database tables on startup
    Base.metadata.create_all(bind=engine)
    print(f"SIGN Platform AI Backend started. NestJS API: {settings.NESTJS_API_URL}")
    yield
    # Cleanup on shutdown
    print("SIGN Platform AI Backend shutting down.")


app = FastAPI(
    title="SIGN Platform AI Backend",
    description="AI agents and services for the SIGN contract management platform.",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS middleware - allow the NestJS backend
settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        settings.NESTJS_API_URL,
        "http://localhost:3000",
        "http://localhost:3001",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(agents.router, tags=["AI Agents"])
app.include_router(embeddings.router, tags=["Embeddings"])


@app.get("/health", summary="Health Check")
async def health_check() -> dict[str, str]:
    """Health check endpoint to verify the service is running."""
    return {"status": "healthy", "service": "sign-ai-backend"}
