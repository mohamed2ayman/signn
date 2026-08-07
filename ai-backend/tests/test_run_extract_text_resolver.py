"""Step-2 transition tests for tasks.run_extract_text (file_url vs file_path).

The extractor is mocked (no real OCR) and boto3 is mocked (no real S3, no AWS
credentials), so these run fast in CI. They verify:
  - legacy file_path is byte-identical (the resolver is never consulted),
  - file_url routes through the resolver (local /uploads/ re-root + S3
    download-to-temp),
  - file_url wins over file_path and logs it,
  - neither field is a loud, clean task failure,
  - a resolver error surfaces as a clean task failure (not a silent success),
  - the LIFETIME guard: the S3 temp file EXISTS during the extractor call and is
    GONE afterward (the bug we must not ship).
The request-model guard (route layer) is tested too.
"""

import os

import pytest
from unittest import mock

import app.tasks as tasks

S3_URL = "https://sign-test-bucket.s3.eu-west-1.amazonaws.com/contracts/synthetic.pdf"
LOCAL_URL = "http://localhost:3000/uploads/contracts/abc.pdf"


class _FakeS3:
    """Minimal boto3 S3 client stand-in: HEAD reports size, download writes bytes."""

    def __init__(self, data=b"pdf-bytes"):
        self._data = data

    def head_object(self, Bucket, Key):  # noqa: N803 — boto3's kwarg names
        return {"ContentLength": len(self._data)}

    def download_file(self, Bucket, Key, Filename):  # noqa: N803
        with open(Filename, "wb") as f:
            f.write(self._data)


def _mock_extractor(mocker, record):
    """Patch get_text_extractor → a mock recording the path it was handed."""
    extractor = mock.MagicMock()

    def _extract(file_path, mime_type):
        record["path"] = file_path
        record["mime_type"] = mime_type
        record["existed_during"] = os.path.exists(file_path)
        return {"text": "extracted", "page_count": 1}

    extractor.extract.side_effect = _extract
    mocker.patch(
        "app.services.text_extractor_factory.get_text_extractor",
        return_value=extractor,
    )
    return extractor


def test_legacy_file_path_only_is_unchanged_and_resolver_untouched(mocker):
    rec: dict = {}
    _mock_extractor(mocker, rec)
    resolver = mocker.patch("app.tasks.resolve_to_local_path")

    result = tasks.run_extract_text.run(
        {"file_path": "/app/uploads/contracts/x.pdf", "mime_type": "application/pdf"}
    )

    assert result["status"] == "completed"
    assert result["result"]["text"] == "extracted"
    assert result["result"]["quality_flags"] == []
    # Extractor got EXACTLY the legacy path; the resolver was never consulted.
    assert rec["path"] == "/app/uploads/contracts/x.pdf"
    assert rec["mime_type"] == "application/pdf"
    resolver.assert_not_called()


def test_file_url_local_reroots_to_uploads(mocker):
    rec: dict = {}
    _mock_extractor(mocker, rec)
    boto = mocker.patch("boto3.client")  # must NOT be touched on the local branch

    result = tasks.run_extract_text.run(
        {"file_url": LOCAL_URL, "mime_type": "application/pdf"}
    )

    assert result["status"] == "completed"
    assert rec["path"] == "/app/uploads/contracts/abc.pdf"
    boto.assert_not_called()


def test_file_url_s3_temp_exists_during_extract_and_gone_after(mocker):
    rec: dict = {}
    _mock_extractor(mocker, rec)
    mocker.patch("boto3.client", return_value=_FakeS3(b"the pdf bytes"))

    result = tasks.run_extract_text.run(
        {"file_url": S3_URL, "mime_type": "application/pdf"}
    )

    assert result["status"] == "completed"
    assert rec["path"].startswith("/tmp/")
    assert rec["existed_during"] is True      # temp present WHILE extracting
    assert not os.path.exists(rec["path"])    # cleaned up after the task returns


def test_both_fields_present_file_url_wins_and_logs(mocker, caplog):
    rec: dict = {}
    _mock_extractor(mocker, rec)
    mocker.patch("boto3.client")  # LOCAL_URL takes the local branch; defensive

    with caplog.at_level("INFO", logger="app.tasks"):
        result = tasks.run_extract_text.run(
            {
                "file_url": LOCAL_URL,
                "file_path": "/app/uploads/contracts/LEGACY.pdf",
                "mime_type": "application/pdf",
            }
        )

    assert result["status"] == "completed"
    # file_url won: extractor got the URL-derived path, NOT the legacy file_path.
    assert rec["path"] == "/app/uploads/contracts/abc.pdf"
    assert any("preferring file_url" in m for m in caplog.messages)


def test_neither_field_is_a_loud_task_failure(mocker):
    _mock_extractor(mocker, {})

    result = tasks.run_extract_text.run({"mime_type": "application/pdf"})

    assert result["status"] == "failed"
    assert "file_url" in result["error"] and "file_path" in result["error"]


def test_resolver_error_surfaces_as_clean_task_failure(mocker):
    _mock_extractor(mocker, {})

    # A URL matching neither shape → resolver raises → the task fails CLEANLY
    # (not a silent success with empty text).
    result = tasks.run_extract_text.run(
        {
            "file_url": "https://example.com/files/not-uploads/x.pdf",
            "mime_type": "application/pdf",
        }
    )

    assert result["status"] == "failed"
    assert "matches neither" in result["error"]


def test_request_model_requires_a_source():
    """Route-layer guard: the request model rejects a body with neither field."""
    from app.models.schemas import TextExtractionRequest

    with pytest.raises(Exception):
        TextExtractionRequest(mime_type="application/pdf")

    # Either field alone is accepted.
    TextExtractionRequest(file_path="/app/uploads/x.pdf", mime_type="application/pdf")
    TextExtractionRequest(
        file_url="http://h/uploads/x.pdf", mime_type="application/pdf"
    )
