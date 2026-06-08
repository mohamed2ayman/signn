"""Phase 7.27 — on_failure backstop for run_ingest_legal_document.

When the worker dies mid-task (OOM/SIGKILL, time-limit, unhandled error), the
task body's _mark_document_status FAILED path never runs, leaving the document
stuck in PENDING/PROCESSING.  The custom task base's on_failure issues a
status-guarded UPDATE to mark it FAILED — but never overwrites a doc that
already reached a terminal state (INDEXED/FAILED).

DB is mocked; no real Postgres.
"""

from __future__ import annotations

from unittest.mock import MagicMock

from billiard.exceptions import WorkerLostError

from app.tasks import run_ingest_legal_document


def _mock_db(mocker, rowcount):
    """Patch psycopg2.connect (imported inside on_failure) + get_settings.

    Returns the cursor mock so tests can inspect the executed SQL.
    """
    fake_settings = MagicMock()
    fake_settings.DATABASE_URL = "postgresql://x/y"
    mocker.patch("app.tasks.get_settings", return_value=fake_settings)

    cur = MagicMock()
    cur.rowcount = rowcount
    conn = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cur
    mocker.patch("psycopg2.connect", return_value=conn)
    return cur


def test_on_failure_marks_document_failed(mocker):
    """OOM-style failure → guarded UPDATE sets FAILED with the exception text."""
    cur = _mock_db(mocker, rowcount=1)  # 1 row updated = doc was non-terminal
    exc = WorkerLostError("Worker exited prematurely: signal 9 (SIGKILL)")

    run_ingest_legal_document.on_failure(
        exc,
        "task-abc",
        [{"document_id": "doc-1"}],  # args (send_task(args=[request_data]))
        {},                          # kwargs
        None,                        # einfo
    )

    cur.execute.assert_called_once()
    sql, params = cur.execute.call_args.args
    assert "FAILED" in sql
    assert "embedding_status IN ('PENDING', 'PROCESSING')" in sql  # status guard
    error_msg, doc_id = params
    assert doc_id == "doc-1"
    assert "signal 9" in error_msg


def test_on_failure_skips_terminal_documents(mocker):
    """Already-terminal doc (INDEXED/FAILED) → guarded UPDATE affects 0 rows, no raise."""
    cur = _mock_db(mocker, rowcount=0)  # 0 rows = WHERE guard excluded a terminal doc

    # Must not raise even though nothing was updated.
    run_ingest_legal_document.on_failure(
        RuntimeError("late failure"),
        "task-xyz",
        [{"document_id": "doc-2"}],
        {},
        None,
    )

    # The UPDATE was still attempted, but its WHERE clause is the safety net.
    cur.execute.assert_called_once()
    sql, params = cur.execute.call_args.args
    assert "embedding_status IN ('PENDING', 'PROCESSING')" in sql
    assert params[1] == "doc-2"


def test_on_failure_no_document_id_is_noop(mocker):
    """No document_id in args → backstop does nothing (no DB connection)."""
    connect = mocker.patch("psycopg2.connect")
    mocker.patch("app.tasks.get_settings", return_value=MagicMock())

    run_ingest_legal_document.on_failure(
        RuntimeError("boom"), "task-1", [{}], {}, None
    )

    connect.assert_not_called()
