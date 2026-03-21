"""Embedding service for generating, storing, and searching vector embeddings."""

from __future__ import annotations

from typing import Any

import numpy as np
from openai import OpenAI

from app.config.settings import get_settings

EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIMENSIONS = 1536


class EmbeddingService:
    """Manages OpenAI embeddings and an in-process vector store.

    Note: In production this would be backed by pgvector.  The current
    implementation keeps an in-memory store so the service can run without
    a database during development.
    """

    def __init__(self) -> None:
        settings = get_settings()
        self._client = OpenAI(api_key=settings.OPENAI_API_KEY)
        # In-memory store: list of dicts with keys asset_id, embedding, metadata, text
        self._store: list[dict[str, Any]] = []

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def generate_embedding(self, text: str) -> list[float]:
        """Generate an embedding vector for *text* using OpenAI."""
        response = self._client.embeddings.create(
            model=EMBEDDING_MODEL,
            input=text,
        )
        return response.data[0].embedding

    def store_embedding(
        self,
        asset_id: str,
        embedding: list[float],
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """Persist an embedding alongside its metadata.

        Duplicates (same *asset_id*) are replaced.
        """
        # Remove existing entry if present
        self._store = [
            entry for entry in self._store if entry["asset_id"] != asset_id
        ]
        self._store.append(
            {
                "asset_id": asset_id,
                "embedding": embedding,
                "metadata": metadata or {},
            }
        )

    def search_similar(
        self,
        query: str,
        org_id: str,
        filters: dict[str, Any] | None = None,
        top_k: int = 5,
    ) -> list[dict[str, Any]]:
        """Return the *top_k* most similar stored embeddings for *query*.

        Results are filtered by *org_id* and optional *filters* dict (matched
        against stored metadata keys).
        """
        query_embedding = self.generate_embedding(query)
        query_vec = np.array(query_embedding, dtype=np.float64)

        scored: list[tuple[float, dict[str, Any]]] = []
        for entry in self._store:
            meta = entry.get("metadata", {})

            # Tenant isolation
            if meta.get("org_id") != org_id:
                continue

            # Optional metadata filters
            if filters:
                if not all(meta.get(k) == v for k, v in filters.items()):
                    continue

            entry_vec = np.array(entry["embedding"], dtype=np.float64)
            score = float(self._cosine_similarity(query_vec, entry_vec))
            scored.append((score, entry))

        # Sort descending by score
        scored.sort(key=lambda x: x[0], reverse=True)

        results: list[dict[str, Any]] = []
        for score, entry in scored[:top_k]:
            results.append(
                {
                    "asset_id": entry["asset_id"],
                    "score": round(score, 4),
                    "text": entry["metadata"].get("text", ""),
                    "metadata": entry["metadata"],
                }
            )
        return results

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> np.floating[Any]:
        """Compute cosine similarity between two vectors."""
        dot = np.dot(a, b)
        norm_a = np.linalg.norm(a)
        norm_b = np.linalg.norm(b)
        if norm_a == 0 or norm_b == 0:
            return np.float64(0.0)
        return dot / (norm_a * norm_b)
