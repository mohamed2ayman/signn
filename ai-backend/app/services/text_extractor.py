"""Backward-compatible re-export of TesseractTextExtractor.

Any existing code that imports ``TextExtractorService`` from this module
continues to work without modification::

    from app.services.text_extractor import TextExtractorService
    service = TextExtractorService()

New code should import from the concrete module directly:

    from app.services.tesseract_text_extractor import TesseractTextExtractor

Or use the factory (preferred for task code):

    from app.services.text_extractor_factory import get_text_extractor
"""

from __future__ import annotations

from app.services.tesseract_text_extractor import TesseractTextExtractor

# Alias kept for backward compatibility — do not remove without a grep sweep.
TextExtractorService = TesseractTextExtractor

__all__ = ["TextExtractorService"]
