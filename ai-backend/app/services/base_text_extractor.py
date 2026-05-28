"""Abstract base class for PDF text extraction backends.

Only PDF extraction is abstracted here.  Non-PDF format handling
(DOCX, DOC, XLSX, PPTX, plain text) lives on the concrete subclass
:class:`~app.services.tesseract_text_extractor.TesseractTextExtractor`
and is not part of this interface — it does not vary across extraction
backends.
"""

from __future__ import annotations

from abc import ABC, abstractmethod


class BaseTextExtractor(ABC):
    """Base class for text extraction backends.

    Subclasses must implement :meth:`extract_pdf`.  All non-PDF format
    handling is optional and lives on the concrete subclass; it is not
    part of this interface.
    """

    @abstractmethod
    def extract_pdf(self, file_path: str, page_count: int) -> str:
        """Extract plain text from a PDF file.

        Parameters
        ----------
        file_path:
            Path to the PDF file on the local filesystem.
        page_count:
            Total page count, determined by the caller before this method
            is invoked.  Passed explicitly so that *_ocr_pdf* (or its
            equivalent in a subclass) does not need to read shared mutable
            instance state — which is unsafe across concurrent Celery tasks.

        Returns
        -------
        str
            Extracted plain text.  Empty string if all extraction
            strategies fail.
        """
