"""Factory for creating a text extractor backend.

Reads the ``TEXT_EXTRACTOR`` environment variable (default: ``"tesseract"``)
and returns the appropriate :class:`~app.services.base_text_extractor.BaseTextExtractor`
implementation.

Supported values
----------------
``tesseract`` (default)
    :class:`~app.services.tesseract_text_extractor.TesseractTextExtractor` —
    three-strategy PDF cascade (PyPDF2 → pdftotext → pytesseract) plus all
    non-PDF formats.

``textract``
    :class:`~app.services.textract_text_extractor.TextractTextExtractor` —
    skeleton only; raises :class:`NotImplementedError` until S3 storage is
    active and the NestJS side passes S3 coordinates.

All concrete imports are lazy (inside the function body) to preserve the
pattern established in the Celery task layer and to avoid importing heavy
OCR dependencies at module load time.
"""

from __future__ import annotations

from app.services.base_text_extractor import BaseTextExtractor


def get_text_extractor() -> BaseTextExtractor:
    """Return the configured text extraction backend.

    Reads :attr:`~app.config.settings.Settings.TEXT_EXTRACTOR` from the
    application settings (backed by the ``TEXT_EXTRACTOR`` env var, default
    ``"tesseract"``).

    Returns
    -------
    BaseTextExtractor
        A concrete extractor instance.  In practice this is always a
        :class:`~app.services.tesseract_text_extractor.TesseractTextExtractor`
        unless ``TEXT_EXTRACTOR=textract`` is explicitly set.
    """
    from app.config.settings import get_settings

    settings = get_settings()
    driver = getattr(settings, "TEXT_EXTRACTOR", "tesseract")

    if driver == "textract":
        from app.services.textract_text_extractor import TextractTextExtractor

        return TextractTextExtractor(
            aws_access_key_id=getattr(settings, "AWS_ACCESS_KEY_ID", ""),
            aws_secret_access_key=getattr(settings, "AWS_SECRET_ACCESS_KEY", ""),
            aws_region=getattr(settings, "AWS_REGION", "us-east-1"),
            s3_bucket=getattr(settings, "AWS_S3_BUCKET", ""),
        )

    # Default: tesseract
    from app.services.tesseract_text_extractor import TesseractTextExtractor

    return TesseractTextExtractor()
