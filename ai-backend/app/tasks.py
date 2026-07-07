"""Celery tasks that execute AI agent work asynchronously."""

from __future__ import annotations

import json
from typing import Any

from celery import Celery

from app.config.settings import get_settings

settings = get_settings()

celery_app = Celery(
    "sign_ai",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    result_expires=3600,  # Results expire after 1 hour
    task_track_started=True,
    worker_max_memory_per_child=500_000,  # Restart worker after 500MB to reclaim leaked memory
    task_soft_time_limit=300,  # 5 minute soft limit
    task_time_limit=600,  # 10 minute hard limit
)


@celery_app.task(name="tasks.run_risk_analysis", bind=True)
def run_risk_analysis(self, request_data: dict[str, Any]) -> dict[str, Any]:
    """Execute risk analysis on contract clauses."""
    from app.agents.risk_analyzer import RiskAnalyzerAgent

    agent = RiskAnalyzerAgent()
    try:
        risks = agent.analyze(
            clauses=request_data["clauses"],
            knowledge_context=request_data.get("knowledge_context"),
        )
        return {"status": "completed", "result": {"risks": risks}}
    except Exception as e:
        return {"status": "failed", "error": str(e)}


@celery_app.task(name="tasks.run_rephrase_clause", bind=True)
def run_rephrase_clause(self, request_data: dict[str, Any]) -> dict[str, Any]:
    """Re-phrase a single clause to reduce/remove an identified risk."""
    from app.agents.clause_rewriter import ClauseRewriterAgent

    agent = ClauseRewriterAgent()
    try:
        result = agent.rewrite(
            clause_text=request_data["clause_text"],
            clause_title=request_data.get("clause_title"),
            risk_description=request_data.get("risk_description"),
            recommendation=request_data.get("recommendation"),
        )
        return {"status": "completed", "result": result}
    except Exception as e:
        return {"status": "failed", "error": str(e)}


@celery_app.task(name="tasks.run_summarize", bind=True)
def run_summarize(self, request_data: dict[str, Any]) -> dict[str, Any]:
    """Generate a structured contract summary."""
    from app.agents.summarizer import SummarizerAgent

    agent = SummarizerAgent()
    try:
        summary = agent.summarize(full_text=request_data["full_text"])
        return {"status": "completed", "result": {"summary": summary}}
    except Exception as e:
        return {"status": "failed", "error": str(e)}


@celery_app.task(name="tasks.run_diff_analysis", bind=True)
def run_diff_analysis(self, request_data: dict[str, Any]) -> dict[str, Any]:
    """Analyze differences between contract versions."""
    from app.agents.diff_analyzer import DiffAnalyzerAgent

    agent = DiffAnalyzerAgent()
    try:
        result = agent.analyze_diff(
            original_clauses=request_data["original_clauses"],
            modified_clauses=request_data["modified_clauses"],
        )
        return {"status": "completed", "result": result}
    except Exception as e:
        return {"status": "failed", "error": str(e)}


@celery_app.task(name="tasks.run_extract_obligations", bind=True)
def run_extract_obligations(self, request_data: dict[str, Any]) -> dict[str, Any]:
    """Extract obligations from contract clauses."""
    from app.agents.obligations_extractor import ObligationsExtractorAgent

    agent = ObligationsExtractorAgent()
    try:
        obligations = agent.extract(clauses=request_data["clauses"])
        return {"status": "completed", "result": {"obligations": obligations}}
    except Exception as e:
        return {"status": "failed", "error": str(e)}


@celery_app.task(name="tasks.run_conflict_detection", bind=True)
def run_conflict_detection(self, request_data: dict[str, Any]) -> dict[str, Any]:
    """Detect conflicts between clauses from different documents."""
    from app.agents.conflict_detector import ConflictDetectorAgent

    agent = ConflictDetectorAgent()
    try:
        result = agent.detect(clauses=request_data["clauses"])
        return {"status": "completed", "result": result}
    except Exception as e:
        return {"status": "failed", "error": str(e)}


@celery_app.task(name="tasks.run_chat", bind=True)
def run_chat(self, request_data: dict[str, Any]) -> dict[str, Any]:
    """Run a conversational chat interaction."""
    from app.agents.conversational_agent import ConversationalAgent

    agent = ConversationalAgent()
    try:
        result = agent.chat(
            message=request_data["message"],
            contract_context=request_data.get("contract_context"),
            knowledge_context=request_data.get("knowledge_context"),
            history=request_data.get("history"),
            system_context=request_data.get("system_context"),
        )
        return {"status": "completed", "result": result}
    except Exception as e:
        return {"status": "failed", "error": str(e)}


@celery_app.task(name="tasks.run_research", bind=True)
def run_research(self, request_data: dict[str, Any]) -> dict[str, Any]:
    """Research legal assets by keywords and jurisdiction."""
    from app.agents.research_agent import ResearchAgent

    agent = ResearchAgent()
    try:
        assets = agent.research(
            keywords=request_data["keywords"],
            jurisdiction=request_data.get("jurisdiction"),
        )
        return {"status": "completed", "result": {"discovered_assets": assets}}
    except Exception as e:
        return {"status": "failed", "error": str(e)}


@celery_app.task(name="tasks.run_extract_text", bind=True)
def run_extract_text(self, request_data: dict[str, Any]) -> dict[str, Any]:
    """Extract text content from an uploaded document file.

    The result dict always contains:
      - ``text`` (str) — extracted text (may be partial on poor scans)
      - ``page_count`` (int)
      - ``quality_flags`` (list[str]) — scan quality signals detected during
        OCR, e.g. ["blur:32.1", "contrast:15.4"].  Empty for digital PDFs
        and non-PDF formats where no OCR was required.
    """
    from app.services.text_extractor_factory import get_text_extractor

    service = get_text_extractor()
    try:
        result = service.extract(
            file_path=request_data["file_path"],
            mime_type=request_data["mime_type"],
        )
        # Guarantee quality_flags is always present in the result shape so
        # the NestJS consumer never needs to guard against a missing key.
        result.setdefault("quality_flags", [])
        return {"status": "completed", "result": result}
    except Exception as e:
        return {"status": "failed", "error": str(e)}


@celery_app.task(
    name="tasks.run_extract_clauses",
    bind=True,
    soft_time_limit=1800,  # 30 min — large Arabic contracts can take ~4 min per AI call with retries
    time_limit=2400,        # 40 min hard kill
)
def run_extract_clauses(self, request_data: dict[str, Any]) -> dict[str, Any]:
    """Extract structured clauses from contract text using AI."""
    from app.agents.clause_extractor import ClauseExtractorAgent

    agent = ClauseExtractorAgent()
    try:
        clauses = agent.extract(
            full_text=request_data["full_text"],
            contract_type=request_data.get("contract_type"),
            document_label=request_data.get("document_label"),
        )
        # quality_flags surfaces content-dedup drops + combined-conditions
        # detection so silent clause loss becomes visible downstream.
        return {
            "status": "completed",
            "result": {
                "clauses": clauses,
                "quality_flags": agent.last_quality_flags,
            },
        }
    except Exception as e:
        return {"status": "failed", "error": str(e)}


@celery_app.task(name="tasks.run_compliance_check", bind=True)
def run_compliance_check(self, request_data: dict[str, Any]) -> dict[str, Any]:
    """Multi-layer compliance check (Phase 3.4)."""
    from app.agents.compliance_checker import ComplianceCheckerAgent

    agent = ComplianceCheckerAgent()
    try:
        result = agent.check(
            contract_type=request_data.get("contract_type"),
            jurisdiction=request_data.get("jurisdiction"),
            clauses=request_data["clauses"],
            standard_knowledge=request_data.get("standard_knowledge"),
            jurisdiction_knowledge=request_data.get("jurisdiction_knowledge"),
            playbook_knowledge=request_data.get("playbook_knowledge"),
        )
        return {"status": "completed", "result": result}
    except Exception as e:
        return {"status": "failed", "error": str(e)}


# ---------------------------------------------------------------------------
# Legal Corpus — Phase 7.27
# ---------------------------------------------------------------------------

EMBED_BATCH_SIZE = 50  # OpenAI embedding API chunks per request

# Backoff schedule (seconds) BEFORE each retry attempt.  4 total attempts:
#   attempt 1 immediate, then waits of 2s, 5s, 12s before attempts 2/3/4.
# Goal: absorb a single transient network blip among the ~22 sequential batch
# calls of a large ingestion — NOT to retry deterministic API errors forever.
_EMBED_RETRY_BACKOFFS = (2, 5, 12)


def embed_batch_with_retry(client, batch: list[str]) -> list[list[float]]:
    """Embed one batch with bounded retry on TRANSIENT OpenAI errors only.

    Retries (with exponential backoff) on connection/timeout/rate-limit errors.
    Does NOT retry deterministic errors (400/401/403/404) — those are re-raised
    immediately so the caller marks the document FAILED without wasting time.

    Raises the last exception if all attempts are exhausted.
    """
    import time

    import openai

    transient = (
        openai.APIConnectionError,
        openai.APITimeoutError,
        openai.RateLimitError,
    )

    last_exc: Exception | None = None
    # len(backoffs) + 1 total attempts (1 immediate + one per backoff entry).
    for attempt in range(len(_EMBED_RETRY_BACKOFFS) + 1):
        try:
            resp = client.embeddings.create(
                model="text-embedding-3-small",
                input=batch,
            )
            return [d.embedding for d in resp.data]
        except transient as exc:
            last_exc = exc
            if attempt < len(_EMBED_RETRY_BACKOFFS):
                time.sleep(_EMBED_RETRY_BACKOFFS[attempt])
                continue
            raise
        # Deterministic errors (BadRequestError, AuthenticationError, etc.)
        # are NOT caught here — they propagate immediately on the first attempt.

    # Unreachable (the loop either returns or raises), but satisfies type checkers.
    raise last_exc  # type: ignore[misc]


@celery_app.task(name="tasks.run_embed_legal_chunks", bind=True)
def run_embed_legal_chunks(self, request_data: dict[str, Any]) -> dict[str, Any]:
    """Embed all PENDING chunks for a legal document.

    Pipeline:
      1. Assert OPENAI_API_KEY is present — fail fast rather than silently.
      2. Read all PENDING chunks for document_id from PostgreSQL.
      3. Batch-embed through OpenAI text-embedding-3-small (EMBED_BATCH_SIZE per call).
      4. Bulk-UPDATE legal_document_chunks.embedding via psycopg2 + pgvector.
      5. Update legal_documents.embedding_status to 'INDEXED' (success) or 'FAILED'.

    The embedding column is intentionally NOT mapped in the TypeORM entity.
    This task owns the write path for that column exclusively.
    """
    import psycopg2
    from psycopg2.extras import execute_values
    from openai import OpenAI

    _s = get_settings()

    # ── 1. Startup assertion ──────────────────────────────────────────────────
    if not _s.OPENAI_API_KEY:
        error_msg = (
            "OPENAI_API_KEY is not set in ai-backend environment. "
            "Legal chunk embedding requires OpenAI text-embedding-3-small."
        )
        _mark_document_status(
            _s.DATABASE_URL,
            request_data["document_id"],
            "FAILED",
            error_msg,
        )
        return {"status": "failed", "error": error_msg}

    document_id: str = request_data["document_id"]
    client = OpenAI(api_key=_s.OPENAI_API_KEY)

    try:
        conn = psycopg2.connect(_s.DATABASE_URL)

        with conn:
            with conn.cursor() as cur:
                # ── 2. Mark as PROCESSING ─────────────────────────────────────
                cur.execute(
                    """
                    UPDATE legal_documents
                    SET    embedding_status = 'PROCESSING', updated_at = NOW()
                    WHERE  id = %s
                      AND  embedding_status IN ('PENDING', 'FAILED')
                    """,
                    (document_id,),
                )

                # ── 3. Read PENDING chunks ────────────────────────────────────
                cur.execute(
                    """
                    SELECT id, chunk_text
                    FROM   legal_document_chunks
                    WHERE  legal_document_id = %s
                      AND  embedding IS NULL
                    ORDER  BY chunk_index
                    """,
                    (document_id,),
                )
                rows = cur.fetchall()

        if not rows:
            # Nothing to embed — document may have been re-queued after
            # a prior successful run; mark INDEXED and return cleanly.
            _mark_document_status(_s.DATABASE_URL, document_id, "INDEXED")
            return {
                "status": "completed",
                "document_id": document_id,
                "chunks_embedded": 0,
            }

        chunk_ids = [r[0] for r in rows]
        chunk_texts = [r[1] for r in rows]

        # ── 4. Batch-embed ────────────────────────────────────────────────────
        all_embeddings: list[list[float]] = []
        for batch_start in range(0, len(chunk_texts), EMBED_BATCH_SIZE):
            batch = chunk_texts[batch_start : batch_start + EMBED_BATCH_SIZE]
            resp = client.embeddings.create(
                model="text-embedding-3-small",
                input=batch,
            )
            # OpenAI preserves input order in the response
            all_embeddings.extend([d.embedding for d in resp.data])

        # ── 5. Bulk-UPDATE embeddings ─────────────────────────────────────────
        # psycopg2 register_vector enables the vector type so we can pass
        # Python lists directly as pgvector values.
        try:
            from pgvector.psycopg2 import register_vector  # type: ignore[import]
            conn2 = psycopg2.connect(_s.DATABASE_URL)
            register_vector(conn2)
        except ImportError:
            # pgvector psycopg2 adapter not installed; fall back to casting
            # the vector as a string literal. This is safe because the values
            # come from the OpenAI API (floats), never from user input.
            conn2 = psycopg2.connect(_s.DATABASE_URL)

        with conn2:
            with conn2.cursor() as cur:
                # Build list of (embedding_str, chunk_id) tuples for execute_values.
                # We use the string representation '[f1,f2,...]::vector' via a cast
                # so this works regardless of whether register_vector is available.
                pairs = [
                    ("[" + ",".join(str(v) for v in emb) + "]", cid)
                    for emb, cid in zip(all_embeddings, chunk_ids)
                ]
                execute_values(
                    cur,
                    """
                    UPDATE legal_document_chunks AS t
                    SET    embedding = v.emb::vector
                    FROM   (VALUES %s) AS v(emb, id)
                    WHERE  t.id = v.id::uuid
                    """,
                    pairs,
                    template="(%s, %s)",
                )

        conn2.close()
        conn.close()

        # ── 6. Mark document INDEXED ──────────────────────────────────────────
        _mark_document_status(_s.DATABASE_URL, document_id, "INDEXED")

        return {
            "status": "completed",
            "document_id": document_id,
            "chunks_embedded": len(chunk_ids),
        }

    except Exception as exc:
        _mark_document_status(
            _s.DATABASE_URL,
            document_id,
            "FAILED",
            str(exc),
        )
        return {"status": "failed", "error": str(exc)}


def _resolve_local_path(file_url: str) -> str:
    """Convert a stored file_url to the local path inside the worker container.

    The backend stores files at /app/uploads/<folder>/<file> and serves them at
    <base_url>/uploads/<folder>/<file>.  The celery-worker shares the same
    ``uploads_data`` volume mounted at /app/uploads, so we strip everything up
    to and including '/uploads/' and re-root under /app/uploads.  This is
    base-URL agnostic (works regardless of host/port in the stored URL).
    """
    marker = "/uploads/"
    idx = file_url.find(marker)
    if idx == -1:
        raise ValueError(f"file_url does not contain '{marker}': {file_url}")
    relative = file_url[idx + len(marker):]
    return "/app/uploads/" + relative


class _IngestLegalDocumentTask(celery_app.Task):
    """Custom base task providing an on_failure BACKSTOP for legal ingestion.

    The task body already marks the document FAILED for *expected* errors via
    _mark_document_status.  This backstop catches the cases the body cannot —
    OOM/SIGKILL (WorkerLostError), time-limit kills, and any unhandled
    exception — which otherwise leave the document stuck in PENDING/PROCESSING
    with no job behind it.

    The UPDATE is status-guarded (WHERE embedding_status IN ('PENDING',
    'PROCESSING')) so it NEVER overwrites a doc that already reached a terminal
    state (INDEXED / FAILED) — e.g. a late on_failure after a successful run.
    Minimal: this adds a base class only; it is NOT a class-based-task rewrite.
    """

    def on_failure(self, exc, task_id, args, kwargs, einfo):  # noqa: D401
        import psycopg2

        # The task is dispatched as send_task(args=[request_data]); be defensive.
        request_data = {}
        if args:
            request_data = args[0] or {}
        elif kwargs:
            request_data = kwargs.get("request_data", {}) or {}
        document_id = request_data.get("document_id")
        if not document_id:
            return  # nothing we can attribute the failure to

        error_msg = f"Task failed: {exc}"
        try:
            conn = psycopg2.connect(get_settings().DATABASE_URL)
            with conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE legal_documents
                        SET    embedding_status = 'FAILED',
                               error_message    = %s,
                               updated_at        = NOW()
                        WHERE  id = %s
                          AND  embedding_status IN ('PENDING', 'PROCESSING')
                        """,
                        (error_msg, document_id),
                    )
                    affected = cur.rowcount
            conn.close()
            print(
                f"[on_failure] legal_document {document_id} "
                f"{'marked FAILED' if affected else 'already terminal — skipped'}: {error_msg}"
            )
        except Exception as backstop_exc:  # noqa: BLE001 — backstop must never raise
            print(f"[on_failure] backstop UPDATE failed for {document_id}: {backstop_exc}")


@celery_app.task(
    name="tasks.run_ingest_legal_document",
    bind=True,
    base=_IngestLegalDocumentTask,
    soft_time_limit=1800,  # 30 min — large Arabic legal corpora
    time_limit=2400,        # 40 min hard kill
)
def run_ingest_legal_document(self, request_data: dict[str, Any]) -> dict[str, Any]:
    """Full legal-document ingestion pipeline (Phase 7.27, Phase E refactor).

    All steps now live in Python so NFKC normalization and tiktoken-based real
    token counting are co-located with chunking:

      1. Assert OPENAI_API_KEY present — fail fast.
      2. Look up the legal_documents row (file_url, jurisdiction).
      3. Resolve file_url -> local path (shared uploads volume).
      4. Extract text via the configured text extractor.
      5. NFKC-normalize and write extracted_text back; set status PROCESSING.
      6. Chunk via the hybrid chunker (NFKC + tiktoken cap).
      7. Bulk-INSERT chunk rows (embedding = NULL).
      8. Batch-embed via OpenAI text-embedding-3-small; bulk-UPDATE vectors.
      9. Mark INDEXED on success; FAILED with error_message on any error.

    The embedding column is owned exclusively by this task (and the legacy
    run_embed_legal_chunks) — never by the TypeORM entity.
    """
    import psycopg2
    from psycopg2.extras import execute_values
    from openai import OpenAI

    from app.services.legal_document_chunker import chunk_legal_document
    from app.services.text_extractor_factory import get_text_extractor

    _s = get_settings()
    document_id: str = request_data["document_id"]

    # ── 1. Startup assertion ──────────────────────────────────────────────────
    if not _s.OPENAI_API_KEY:
        error_msg = (
            "OPENAI_API_KEY is not set in ai-backend environment. "
            "Legal document ingestion requires OpenAI text-embedding-3-small."
        )
        _mark_document_status(_s.DATABASE_URL, document_id, "FAILED", error_msg)
        return {"status": "failed", "error": error_msg}

    try:
        # ── 2. Look up the document row ───────────────────────────────────────
        conn = psycopg2.connect(_s.DATABASE_URL)
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT file_url, jurisdiction FROM legal_documents WHERE id = %s",
                    (document_id,),
                )
                row = cur.fetchone()
        conn.close()

        if not row:
            error_msg = f"legal_documents row not found for id {document_id}"
            _mark_document_status(_s.DATABASE_URL, document_id, "FAILED", error_msg)
            return {"status": "failed", "error": error_msg}

        file_url, jurisdiction = row[0], row[1]
        if not file_url:
            error_msg = f"legal_documents row {document_id} has no file_url"
            _mark_document_status(_s.DATABASE_URL, document_id, "FAILED", error_msg)
            return {"status": "failed", "error": error_msg}

        # ── 3. Resolve local path ─────────────────────────────────────────────
        local_path = _resolve_local_path(file_url)

        # ── 4. Extract text ───────────────────────────────────────────────────
        # force_ocr (from the document's legal_source flag) selects the OCR path
        # for sources with a broken text-layer font encoding (e.g. ETA kaf→آ).
        force_ocr: bool = bool(request_data.get("force_ocr", False))
        extractor = get_text_extractor()
        extraction = extractor.extract(
            local_path, "application/pdf", force_ocr=force_ocr
        )
        raw_text: str = extraction.get("text", "") or ""
        if not raw_text.strip():
            error_msg = "Text extraction returned empty text"
            _mark_document_status(_s.DATABASE_URL, document_id, "FAILED", error_msg)
            return {"status": "failed", "error": error_msg}

        # ── 5. NFKC-normalize + persist text + mark PROCESSING ────────────────
        import unicodedata

        normalized_text = unicodedata.normalize("NFKC", raw_text)
        conn = psycopg2.connect(_s.DATABASE_URL)
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE legal_documents
                    SET    extracted_text   = %s,
                           embedding_status = 'PROCESSING',
                           error_message    = NULL,
                           updated_at       = NOW()
                    WHERE  id = %s
                    """,
                    (normalized_text, document_id),
                )
        conn.close()

        # ── 6. Chunk (chunker re-normalizes defensively; idempotent) ──────────
        # is_visual_order comes from the document's legal_source flag (passed by
        # NestJS).  Default False keeps logical-order behavior for older callers.
        # SUPPRESSION: OCR output is logical-order natively, so when force_ocr is
        # set we MUST NOT also reverse word order — doing so would re-corrupt it.
        # force_ocr therefore overrides is_visual_order to False here.
        is_visual_order: bool = bool(request_data.get("is_visual_order", False))
        if force_ocr:
            is_visual_order = False
        chunks = chunk_legal_document(normalized_text, is_visual_order=is_visual_order)
        if not chunks:
            error_msg = "Chunker produced 0 chunks from extracted text"
            _mark_document_status(_s.DATABASE_URL, document_id, "FAILED", error_msg)
            return {"status": "failed", "error": error_msg}

        # ── 7. Bulk-INSERT chunk rows (embedding = NULL) ──────────────────────
        conn = psycopg2.connect(_s.DATABASE_URL)
        with conn:
            with conn.cursor() as cur:
                # Clear any prior chunks (safe re-ingest of a FAILED doc).
                cur.execute(
                    "DELETE FROM legal_document_chunks WHERE legal_document_id = %s",
                    (document_id,),
                )
                insert_rows = [
                    (
                        document_id,
                        jurisdiction,
                        c["chunk_index"],
                        c["chunk_text"],
                        c["article_reference"],
                        c["token_count"],
                    )
                    for c in chunks
                ]
                execute_values(
                    cur,
                    """
                    INSERT INTO legal_document_chunks
                        (legal_document_id, jurisdiction, chunk_index,
                         chunk_text, article_reference, token_count)
                    VALUES %s
                    """,
                    insert_rows,
                    template="(%s, %s, %s, %s, %s, %s)",
                )
                cur.execute(
                    """
                    SELECT id, chunk_text
                    FROM   legal_document_chunks
                    WHERE  legal_document_id = %s
                    ORDER  BY chunk_index
                    """,
                    (document_id,),
                )
                inserted = cur.fetchall()
        conn.close()

        chunk_ids = [r[0] for r in inserted]
        chunk_texts = [r[1] for r in inserted]

        # ── 8. Batch-embed + bulk-UPDATE vectors ──────────────────────────────
        client = OpenAI(api_key=_s.OPENAI_API_KEY)
        all_embeddings: list[list[float]] = []
        for batch_start in range(0, len(chunk_texts), EMBED_BATCH_SIZE):
            batch = chunk_texts[batch_start : batch_start + EMBED_BATCH_SIZE]
            # Bounded retry on transient network errors only; deterministic
            # API errors (e.g. 400) re-raise immediately and fail the doc.
            all_embeddings.extend(embed_batch_with_retry(client, batch))

        conn = psycopg2.connect(_s.DATABASE_URL)
        with conn:
            with conn.cursor() as cur:
                pairs = [
                    ("[" + ",".join(str(v) for v in emb) + "]", cid)
                    for emb, cid in zip(all_embeddings, chunk_ids)
                ]
                execute_values(
                    cur,
                    """
                    UPDATE legal_document_chunks AS t
                    SET    embedding = v.emb::vector
                    FROM   (VALUES %s) AS v(emb, id)
                    WHERE  t.id = v.id::uuid
                    """,
                    pairs,
                    template="(%s, %s)",
                )
        conn.close()

        # ── 9. Mark INDEXED ───────────────────────────────────────────────────
        _mark_document_status(_s.DATABASE_URL, document_id, "INDEXED")
        return {
            "status": "completed",
            "document_id": document_id,
            "chunks_embedded": len(chunk_ids),
        }

    except Exception as exc:
        _mark_document_status(_s.DATABASE_URL, document_id, "FAILED", str(exc))
        return {"status": "failed", "error": str(exc)}


def _mark_document_status(
    database_url: str,
    document_id: str,
    status: str,
    error_message: str | None = None,
) -> None:
    """Helper — update legal_documents.embedding_status in its own connection.

    Separate connection so a rollback in the main transaction doesn't prevent
    the status update from landing.
    """
    import psycopg2

    try:
        conn = psycopg2.connect(database_url)
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE legal_documents
                    SET    embedding_status = %s,
                           error_message    = %s,
                           updated_at       = NOW()
                    WHERE  id = %s
                    """,
                    (status, error_message, document_id),
                )
        conn.close()
    except Exception:
        pass  # Best-effort — never let a status update failure mask the real error
