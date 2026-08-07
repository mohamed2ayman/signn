"""Tests for app.services.storage_resolver — Step 1 of the S3 worker read-path.

boto3 is mocked (a stubbed client via unittest.mock); NO real S3 and NO AWS
credentials are used, so this runs in CI in milliseconds. Covers: local re-root parity,
S3 download-to-temp, temp cleanup on normal exit AND on exception, unrecognised-URL
and missing-object errors, and the max-size guard.
"""

import os

import pytest
from botocore.exceptions import ClientError
from unittest import mock

from app.services.storage_resolver import (
    StorageResolveError,
    resolve_to_local_path,
)

S3_URL = "https://sign-test-bucket.s3.eu-west-1.amazonaws.com/contracts/synthetic.pdf"


# ── A copy of the ORIGINAL tasks.py::_resolve_local_path — the parity reference ──
# The local branch of resolve_to_local_path must produce a byte-identical path to this
# for the same /uploads/ inputs. If someone "improves" the re-root logic, the parity
# test below goes red.
def _original_resolve_local_path(file_url: str) -> str:
    marker = "/uploads/"
    idx = file_url.find(marker)
    if idx == -1:
        raise ValueError(f"file_url does not contain '{marker}': {file_url}")
    relative = file_url[idx + len(marker):]
    return "/app/uploads/" + relative


class _FakeS3:
    """Minimal stand-in for a boto3 S3 client (head_object + download_file)."""

    def __init__(self, data=b"", size=None, head_error=None, download_error=None):
        self._data = data
        self._size = len(data) if size is None else size
        self._head_error = head_error
        self._download_error = download_error
        self.download_called = False
        self.last_head = None
        self.last_download = None

    def head_object(self, Bucket, Key):  # noqa: N803 — boto3's kwarg names
        self.last_head = (Bucket, Key)
        if self._head_error:
            raise self._head_error
        return {"ContentLength": self._size}

    def download_file(self, Bucket, Key, Filename):  # noqa: N803
        self.download_called = True
        self.last_download = (Bucket, Key, Filename)
        if self._download_error:
            raise self._download_error
        with open(Filename, "wb") as f:
            f.write(self._data)


# ── LOCAL branch ───────────────────────────────────────────────────────────────

def test_local_url_reroots_and_never_touches_boto3():
    url = "http://localhost:3000/uploads/contracts/abc.pdf"
    # Patch boto3.client so any accidental use on the local branch is caught.
    with mock.patch("boto3.client") as mock_client:
        with resolve_to_local_path(url) as path:
            assert path == "/app/uploads/contracts/abc.pdf"
        mock_client.assert_not_called()


@pytest.mark.parametrize(
    "url",
    [
        "http://localhost:3000/uploads/contracts/abc.pdf",
        "https://base.example.com/uploads/legal-documents/x.pdf",
        "http://h/uploads/knowledge-assets/y.docx",
        "http://localhost:3000/uploads/parse-docx/z.docx",
    ],
)
def test_parity_with_original_resolve_local_path(url):
    """Regression guard: local branch == the original tasks.py::_resolve_local_path."""
    with resolve_to_local_path(url) as path:
        assert path == _original_resolve_local_path(url)


# ── S3 branch ──────────────────────────────────────────────────────────────────

def test_s3_url_downloads_bytes_to_temp():
    payload = b"test file, not a contract\n\x00\x01\x02"
    fake = _FakeS3(data=payload)
    with mock.patch("boto3.client", return_value=fake):
        with resolve_to_local_path(S3_URL) as path:
            assert path.startswith("/tmp/")
            with open(path, "rb") as f:
                assert f.read() == payload


def test_s3_parsing_bucket_key_and_region():
    fake = _FakeS3(data=b"data")
    with mock.patch("boto3.client", return_value=fake) as mock_client:
        with resolve_to_local_path(S3_URL):
            pass
    # region parsed from the host and passed to boto3.client
    assert mock_client.call_args.kwargs.get("region_name") == "eu-west-1"
    # bucket + key parsed correctly for both HEAD and download
    assert fake.last_head == ("sign-test-bucket", "contracts/synthetic.pdf")
    assert fake.last_download[:2] == ("sign-test-bucket", "contracts/synthetic.pdf")


def test_temp_removed_on_normal_exit():
    fake = _FakeS3(data=b"hello")
    with mock.patch("boto3.client", return_value=fake):
        with resolve_to_local_path(S3_URL) as path:
            assert os.path.exists(path)
            captured = path
        assert not os.path.exists(captured)  # cleaned up after the with-block


def test_temp_removed_when_body_raises():
    fake = _FakeS3(data=b"hello")
    captured = {}
    with mock.patch("boto3.client", return_value=fake):
        with pytest.raises(RuntimeError, match="boom in extraction"):
            with resolve_to_local_path(S3_URL) as path:
                captured["path"] = path
                assert os.path.exists(path)
                raise RuntimeError("boom in extraction")
    assert not os.path.exists(captured["path"])  # finally cleaned it up despite the raise


# ── Fail-loudly paths ────────────────────────────────────────────────────────────

def test_unrecognised_url_raises_clearly():
    with pytest.raises(StorageResolveError, match="matches neither"):
        with resolve_to_local_path("https://example.com/files/not-uploads/x.pdf"):
            pass


def test_empty_or_none_url_raises():
    for bad in ("", None):
        with pytest.raises(StorageResolveError, match="non-empty string"):
            with resolve_to_local_path(bad):
                pass


def test_missing_s3_object_raises_clearly():
    err = ClientError({"Error": {"Code": "404", "Message": "Not Found"}}, "HeadObject")
    fake = _FakeS3(head_error=err)
    with mock.patch("boto3.client", return_value=fake):
        with pytest.raises(StorageResolveError, match="not found or inaccessible"):
            with resolve_to_local_path(S3_URL):
                pass


def test_download_failure_raises_and_cleans_temp():
    err = ClientError({"Error": {"Code": "500", "Message": "Boom"}}, "GetObject")
    fake = _FakeS3(data=b"x", download_error=err)
    with mock.patch("boto3.client", return_value=fake):
        with pytest.raises(StorageResolveError, match="failed to download"):
            with resolve_to_local_path(S3_URL):
                pass
    # the tempfile created for the download attempt was cleaned up before raising
    assert fake.last_download is not None
    assert not os.path.exists(fake.last_download[2])


def test_max_size_guard_triggers_before_download():
    # 600 MB reported by HEAD (no real bytes) → over the 500 MB limit.
    fake = _FakeS3(data=b"x", size=600 * 1024 * 1024)
    with mock.patch("boto3.client", return_value=fake):
        with pytest.raises(StorageResolveError, match="too large"):
            with resolve_to_local_path(S3_URL):
                pass
    assert fake.download_called is False  # guard fires BEFORE any download
