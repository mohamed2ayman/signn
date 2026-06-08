"""Phase 7.27 — force_ocr suppresses visual-order reversal in the ingest task.

When a source is force_ocr=True, OCR emits logical-order Arabic, so the chunker
must receive is_visual_order=False even if the source is ALSO flagged
is_visual_order=True.  This verifies the suppression guard in
run_ingest_legal_document via the task path with the DB / extractor / chunker
mocked (no real Postgres, no real OCR).
"""

from __future__ import annotations

from unittest.mock import MagicMock

import app.tasks as tasks


def _patch_common(mocker, extractor_text="مادة 1 نص نظيف"):
    """Mock everything the task touches up to (and including) the chunk call."""
    # Settings with a present OPENAI key so the startup assertion passes.
    fake_settings = MagicMock()
    fake_settings.OPENAI_API_KEY = "sk-test"
    fake_settings.DATABASE_URL = "postgresql://x/y"
    mocker.patch("app.tasks.get_settings", return_value=fake_settings)

    # psycopg2.connect → context-managed conn + cursor; doc lookup returns a row.
    # psycopg2 is imported INSIDE the task body, so patch it at the source module.
    cur = MagicMock()
    cur.fetchone.return_value = ("http://h/uploads/legal-documents/x.pdf", "EG")
    conn = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cur
    mocker.patch("psycopg2.connect", return_value=conn)

    mocker.patch("app.tasks._resolve_local_path", return_value="/tmp/x.pdf")
    mocker.patch("app.tasks._mark_document_status")

    # Extractor + chunker are imported inside the task body — patch at source.
    extractor = MagicMock()
    extractor.extract.return_value = {
        "text": extractor_text,
        "page_count": 1,
        "quality_flags": ["ocr_forced"],
    }
    mocker.patch(
        "app.services.text_extractor_factory.get_text_extractor",
        return_value=extractor,
    )

    # chunk_legal_document is the thing under test — capture its kwargs.
    # Return [] so the task short-circuits right after (no embed loop needed).
    chunk = mocker.patch(
        "app.services.legal_document_chunker.chunk_legal_document",
        return_value=[],
    )
    return chunk, extractor


def test_force_ocr_suppresses_visual_reversal(mocker):
    """force_ocr=True AND is_visual_order=True → chunker gets is_visual_order=False."""
    chunk, extractor = _patch_common(mocker)

    tasks.run_ingest_legal_document.run(
        {"document_id": "doc-1", "is_visual_order": True, "force_ocr": True}
    )

    # Extractor was asked to OCR.
    assert extractor.extract.call_args.kwargs.get("force_ocr") is True
    # Despite is_visual_order=True on the source, the chunker is called with False.
    assert chunk.call_args.kwargs.get("is_visual_order") is False


def test_visual_order_preserved_when_not_force_ocr(mocker):
    """force_ocr=False keeps is_visual_order passthrough intact (no suppression)."""
    chunk, extractor = _patch_common(mocker)

    tasks.run_ingest_legal_document.run(
        {"document_id": "doc-2", "is_visual_order": True, "force_ocr": False}
    )

    assert extractor.extract.call_args.kwargs.get("force_ocr") is False
    # No suppression → the source's visual-order flag reaches the chunker.
    assert chunk.call_args.kwargs.get("is_visual_order") is True
