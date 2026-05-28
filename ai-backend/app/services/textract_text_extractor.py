"""AWS Textract text extraction backend — skeleton only.

This class is a placeholder for a future Textract integration.
``extract_pdf`` raises :class:`NotImplementedError` until the prerequisites
are met:

Prerequisites (not yet satisfied):
- S3 storage must be active (Phase 9.1a S3 adapter deployed).
- NestJS ``DocumentProcessingService.getLocalFilePath()`` must be replaced
  with logic that passes S3 coordinates (bucket + key) instead of a local
  filesystem path.
- ``boto3`` must be added to ``requirements.txt``.
- For documents > 5 pages, the Celery task's ``soft_time_limit`` and
  ``time_limit`` must be raised to accommodate Textract's async polling.

DO NOT implement real Textract API calls here until all prerequisites are met.
"""

from __future__ import annotations

from app.services.base_text_extractor import BaseTextExtractor


class TextractTextExtractor(BaseTextExtractor):
    """AWS Textract extraction backend (skeleton — not yet functional).

    Instantiated by the factory when ``TEXT_EXTRACTOR=textract`` is set,
    but ``extract_pdf`` immediately raises :class:`NotImplementedError`
    to make the incomplete state explicit rather than silently failing.
    """

    def __init__(
        self,
        aws_access_key_id: str = "",
        aws_secret_access_key: str = "",
        aws_region: str = "us-east-1",
        s3_bucket: str = "",
    ) -> None:
        self._aws_access_key_id = aws_access_key_id
        self._aws_secret_access_key = aws_secret_access_key
        self._aws_region = aws_region
        self._s3_bucket = s3_bucket

    def extract_pdf(self, file_path: str, page_count: int) -> str:
        """Not implemented — Textract requires S3 storage.

        Raises
        ------
        NotImplementedError
            Always.  Implement only after the prerequisites listed in the
            module docstring are satisfied.
        """
        raise NotImplementedError(
            "Textract requires S3 storage — not yet implemented. "
            "See ai-backend/app/services/textract_text_extractor.py for prerequisites."
        )
