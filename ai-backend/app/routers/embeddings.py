"""Router for embedding / vector-store endpoints."""

from __future__ import annotations

from fastapi import APIRouter

from app.models.schemas import (
    EmbeddingIngestRequest,
    EmbeddingSearchRequest,
    EmbeddingSearchResponse,
)
from app.services.embedding_service import EmbeddingService

router = APIRouter(prefix="/embeddings")

embedding_service = EmbeddingService()


@router.post(
    "/ingest",
    summary="Ingest a document into the vector store",
    response_model=dict[str, str],
)
async def ingest(request: EmbeddingIngestRequest) -> dict[str, str]:
    """Generate an embedding for the supplied text and store it."""
    embedding = embedding_service.generate_embedding(request.text)
    embedding_service.store_embedding(
        asset_id=request.asset_id,
        embedding=embedding,
        metadata={
            "org_id": request.org_id,
            **request.metadata,
        },
    )
    return {"status": "ingested", "asset_id": request.asset_id}


@router.post(
    "/search",
    summary="Search the vector store",
    response_model=EmbeddingSearchResponse,
)
async def search(request: EmbeddingSearchRequest) -> EmbeddingSearchResponse:
    """Find similar documents in the vector store."""
    results = embedding_service.search_similar(
        query=request.query,
        org_id=request.org_id,
        filters=request.filters,
        top_k=request.top_k,
    )
    return EmbeddingSearchResponse(results=results)
