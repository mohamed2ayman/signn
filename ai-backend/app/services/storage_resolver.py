"""Storage resolver — turn a stored ``file_url`` into a usable LOCAL path for the worker.

Step 1 of the S3 worker read-path (AWS migration). This module is INTENTIONALLY
un-wired: NOTHING imports or calls it yet. Wiring the three entry points
(``run_extract_text``, ``run_ingest_legal_document``, and the parse-docx dispatch)
onto this helper is Step 2. Adding this file changes NO behaviour.

Two branches, mirroring the backend's ``LocalStorageAdapter`` / ``S3StorageAdapter``
split so a stored ``file_url`` round-trips the same way on both sides:

* LOCAL — a ``…/uploads/<folder>/<file>`` URL is re-rooted under ``/app/uploads/…``
  (the shared ``uploads_data`` volume). Behaviour is IDENTICAL to the existing
  ``tasks.py::_resolve_local_path`` (its body is quoted verbatim below for parity).

* S3 — an ``https://<bucket>.s3.<region>.amazonaws.com/<key>`` URL (exactly what
  ``S3StorageAdapter.keyToUrl`` stores) is downloaded via boto3's DEFAULT credential
  chain to a tempfile under ``/tmp``, which is DELETED in a ``finally`` so a failed
  extraction cannot leak disk. boto3's default chain means ECS task roles / IRSA work
  with no code change, and local dev (STORAGE_DRIVER=local, S3 branch never taken)
  needs no credentials at all.

FAIL LOUDLY: a URL matching neither shape, a missing/inaccessible S3 object, or an
oversize object raises :class:`StorageResolveError` naming what it got. This module
never returns a silently-wrong path — silent misresolution is the exact failure mode
the S3 migration is trying to avoid.
"""

from __future__ import annotations

import contextlib
import logging
import os
import tempfile
from typing import Iterator
from urllib.parse import ParseResult, urlparse

logger = logging.getLogger(__name__)

# Shared-volume root — matches docker-compose ``uploads_data:/app/uploads`` and the
# backend ``LocalStorageAdapter``. The marker + root are the SAME literals the original
# ``_resolve_local_path`` used; kept here as the single edit point.
_LOCAL_MARKER = "/uploads/"
_LOCAL_UPLOADS_ROOT = "/app/uploads/"

# Largest object we will pull down for extraction. Real scanned contracts are a few MB
# (the largest doc in the corpus is ~3 MB); legal-corpus source PDFs run larger but stay
# well under this. 500 MB is a generous ceiling that never rejects a real document yet
# still guards the worker's ephemeral /tmp against a runaway/absurd object.
_MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024  # 500 MB


class StorageResolveError(RuntimeError):
    """Raised when a ``file_url`` cannot be resolved to a usable local path."""


@contextlib.contextmanager
def resolve_to_local_path(file_url: str) -> Iterator[str]:
    """Yield a local filesystem path for *file_url*; clean up any temp file on exit.

    Usage (Step 2 will call it like this)::

        with resolve_to_local_path(file_url) as local_path:
            service.extract(file_path=local_path, mime_type=mime)

    LOCAL branch — behaviour is a VERBATIM port of ``tasks.py::_resolve_local_path``::

        marker = "/uploads/"
        idx = file_url.find(marker)
        if idx == -1:
            raise ValueError(...)
        relative = file_url[idx + len(marker):]
        return "/app/uploads/" + relative

    (Only the exception TYPE differs — ``StorageResolveError`` vs ``ValueError`` — the
    computed path is identical; a parity test guards that.)

    S3 branch — download to a tempfile, yield it, delete it in ``finally``.
    """
    if not file_url or not isinstance(file_url, str):
        raise StorageResolveError(
            f"file_url must be a non-empty string, got: {file_url!r}"
        )

    parsed = urlparse(file_url)

    # ── S3 branch ────────────────────────────────────────────────────────────
    if _is_s3_url(parsed):
        bucket, key = _parse_s3(parsed, file_url)
        tmp_path = _download_s3_to_temp(bucket, key, _region_from_host(parsed))
        try:
            yield tmp_path
        finally:
            with contextlib.suppress(FileNotFoundError):
                os.remove(tmp_path)
        return

    # ── LOCAL branch (verbatim parity with the original _resolve_local_path) ──
    idx = file_url.find(_LOCAL_MARKER)
    if idx == -1:
        raise StorageResolveError(
            "file_url matches neither an S3 URL "
            "(<bucket>.s3.<region>.amazonaws.com) nor a '/uploads/' local URL: "
            f"{file_url!r}"
        )
    relative = file_url[idx + len(_LOCAL_MARKER):]
    # The local file is the shared-volume ORIGINAL — not ours to delete, so no cleanup.
    yield _LOCAL_UPLOADS_ROOT + relative


# ── S3 helpers ───────────────────────────────────────────────────────────────

def _is_s3_url(parsed: ParseResult) -> bool:
    """True for a virtual-hosted S3 URL: ``<bucket>.s3[.<region>].amazonaws.com``.

    This is exactly the shape ``S3StorageAdapter.keyToUrl`` stores; the local adapter
    stores an ``http(s)://…/uploads/…`` URL, which fails this check and takes the
    local branch.
    """
    host = (parsed.hostname or "").lower()
    return host.endswith(".amazonaws.com") and ".s3" in host


def _parse_s3(parsed: ParseResult, file_url: str) -> tuple[str, str]:
    """Return ``(bucket, key)`` from a virtual-hosted S3 URL.

    host = ``<bucket>.s3.<region>.amazonaws.com`` → bucket is everything before
    ``.s3``; key is the path minus its leading ``/`` (mirrors ``urlToKey`` on the
    backend adapter).
    """
    host = (parsed.hostname or "").lower()
    bucket = host.split(".s3", 1)[0]
    key = parsed.path.lstrip("/")
    if not bucket or not key:
        raise StorageResolveError(
            f"unparseable S3 URL (could not derive bucket/key): {file_url!r}"
        )
    return bucket, key


def _region_from_host(parsed: ParseResult) -> str | None:
    """Best-effort region from ``<bucket>.s3.<region>.amazonaws.com``.

    Returns None for the region-less legacy form (``<bucket>.s3.amazonaws.com``) so
    boto3's default region resolution applies.
    """
    host = (parsed.hostname or "").lower()
    after = host.split(".s3", 1)[1] if ".s3" in host else ""
    parts = [p for p in after.split(".") if p]  # e.g. ["eu-west-1", "amazonaws", "com"]
    if len(parts) >= 3 and parts[0] != "amazonaws":
        return parts[0]
    return None


def _download_s3_to_temp(bucket: str, key: str, region: str | None) -> str:
    """HEAD (size guard) then download ``s3://bucket/key`` to a /tmp file; return its path.

    Uses boto3's DEFAULT credential chain (no explicit keys) so ECS task roles / IRSA
    and local ``~/.aws`` all work unchanged. boto3 is imported lazily so this module
    imports cleanly even where boto3 is unused (the local branch never reaches here).
    """
    import boto3
    from botocore.exceptions import BotoCoreError, ClientError

    client_kwargs = {"region_name": region} if region else {}
    s3 = boto3.client("s3", **client_kwargs)

    # Size guard BEFORE downloading — HEAD uses the same s3:GetObject permission as GET.
    try:
        head = s3.head_object(Bucket=bucket, Key=key)
    except (ClientError, BotoCoreError) as exc:
        raise StorageResolveError(
            f"S3 object not found or inaccessible: s3://{bucket}/{key} ({exc})"
        ) from exc

    size = int(head.get("ContentLength", 0))
    if size > _MAX_DOWNLOAD_BYTES:
        raise StorageResolveError(
            f"S3 object too large to download for extraction: {size} bytes exceeds the "
            f"{_MAX_DOWNLOAD_BYTES}-byte limit (s3://{bucket}/{key})"
        )

    # Preserve the extension (harmless; some tools sniff it) via mkstemp under /tmp.
    suffix = os.path.splitext(key)[1] or ""
    fd, tmp_path = tempfile.mkstemp(prefix="sign-s3-", suffix=suffix, dir="/tmp")
    os.close(fd)
    try:
        s3.download_file(bucket, key, tmp_path)
    except (ClientError, BotoCoreError) as exc:
        with contextlib.suppress(FileNotFoundError):
            os.remove(tmp_path)
        raise StorageResolveError(
            f"failed to download s3://{bucket}/{key}: {exc}"
        ) from exc

    logger.info(
        "storage_resolver: s3://%s/%s -> %s (%d bytes)", bucket, key, tmp_path, size
    )
    return tmp_path
