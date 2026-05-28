"""Tesseract-based text extraction (default backend).

Implements the full three-strategy PDF extraction cascade:
  1. PyPDF2  — fast; works for PDFs with a native text layer.
  2. pdftotext (poppler-utils subprocess) — fast; works for PDFs that have
     an embedded text layer that PyPDF2 failed to parse.
  3. pytesseract + pdf2image — full OCR for scanned PDFs, with Arabic + English
     language packs enabled (``ara+eng``).

Non-PDF formats (DOCX, DOC, XLSX, PPTX, plain text) are also handled by this
class — they are not part of the :class:`BaseTextExtractor` interface since they
do not vary across extraction backends.
"""

from __future__ import annotations

import subprocess
from typing import Any

from PyPDF2 import PdfReader
from docx import Document as DocxDocument

from app.services.base_text_extractor import BaseTextExtractor


class TesseractTextExtractor(BaseTextExtractor):
    """Text extractor using Tesseract OCR as the PDF fallback.

    A new instance is created per Celery task invocation.  This class
    intentionally carries *no* shared mutable state between concurrent tasks
    — the old ``self.last_page_count`` side-effect has been eliminated by
    passing ``page_count`` as an explicit parameter to :meth:`_ocr_pdf`.
    """

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    def extract(self, file_path: str, mime_type: str) -> dict[str, Any]:
        """Extract text from *file_path* according to *mime_type*.

        Returns
        -------
        dict with keys ``text`` (str) and ``page_count`` (int).
        """
        mime = mime_type.lower()

        if mime == "application/pdf":
            return self._extract_pdf(file_path)
        elif mime in (
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/docx",
        ):
            return self._extract_docx(file_path)
        elif mime == "application/msword":
            return self._extract_doc(file_path)
        elif mime in (
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.ms-excel",
        ):
            return self._extract_xlsx(file_path)
        elif mime in (
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "application/vnd.ms-powerpoint",
        ):
            return self._extract_pptx(file_path)
        elif mime.startswith("text/"):
            return self._extract_txt(file_path)
        else:
            # Fallback: try reading as plain text
            return self._extract_txt(file_path)

    # ------------------------------------------------------------------
    # PDF — private routing helper
    # ------------------------------------------------------------------

    def _extract_pdf(self, path: str) -> dict[str, Any]:
        """Determine page count, then delegate text extraction to extract_pdf()."""
        reader = PdfReader(path)
        page_count = len(reader.pages)
        text = self.extract_pdf(path, page_count)
        return {"text": text, "page_count": page_count}

    # ------------------------------------------------------------------
    # PDF — BaseTextExtractor implementation
    # ------------------------------------------------------------------

    def extract_pdf(self, file_path: str, page_count: int) -> str:
        """Three-strategy PDF text extraction: PyPDF2 → pdftotext → pytesseract.

        Parameters
        ----------
        file_path:
            Path to the PDF file.
        page_count:
            Page count determined by the caller (from a prior PdfReader open).
            Used by :meth:`_ocr_pdf` as a fallback when ``pdfinfo_from_path``
            fails — eliminates the old ``self.last_page_count`` side-effect.
        """
        reader = PdfReader(file_path)
        pages_text: list[str] = []
        for page in reader.pages:
            pages_text.append(page.extract_text() or "")
        full_text = "\n\n".join(pages_text)

        # If no text was extracted (scanned PDF), attempt OCR
        if not full_text.strip():
            # Prefer the count from the just-opened reader; fall back to the
            # caller-supplied hint if PyPDF2 returned 0 for some reason.
            actual_count = len(reader.pages) or page_count
            full_text = self._ocr_pdf(file_path, actual_count)

        return full_text

    def _ocr_pdf(self, path: str, page_count: int) -> str:
        """Attempt OCR on a scanned PDF.

        Strategy:
        1. ``pdftotext`` (poppler-utils) — fast; for PDFs with an embedded
           text layer that PyPDF2 failed to read.
        2. ``pytesseract`` + ``pdf2image`` — renders each page as an image
           and runs Tesseract OCR with Arabic + English support.

        Parameters
        ----------
        path:
            Path to the PDF file.
        page_count:
            Total page count passed explicitly.  Used as a fallback when
            ``pdfinfo_from_path`` fails — no shared instance state required.
        """

        # --- Attempt 1: pdftotext (poppler) ---
        try:
            result = subprocess.run(
                ["pdftotext", path, "-"],
                capture_output=True,
                text=True,
                timeout=120,
            )
            if result.returncode == 0 and result.stdout.strip():
                return result.stdout
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pass

        # --- Attempt 2: pytesseract + pdf2image (chunked) ---
        # All OCR imports are lazy so the service degrades gracefully when
        # these optional packages are absent (ImportError is caught below).
        try:
            import gc
            import logging
            import pytesseract
            from pdf2image import convert_from_path, pdfinfo_from_path

            logger = logging.getLogger(__name__)

            # Get total page count without loading images
            try:
                info = pdfinfo_from_path(path)
                total_pages = info.get("Pages", 0)
            except Exception:
                # Fall back to the page_count passed by the caller
                total_pages = page_count or 50

            pages_text: list[str] = []
            batch_size = 5  # Process 5 pages at a time to limit memory

            for batch_start in range(1, total_pages + 1, batch_size):
                batch_end = min(batch_start + batch_size - 1, total_pages)
                try:
                    images = convert_from_path(
                        path,
                        dpi=150,
                        first_page=batch_start,
                        last_page=batch_end,
                    )
                    for img in images:
                        try:
                            text = pytesseract.image_to_string(img, lang="ara+eng")
                            if text.strip():
                                pages_text.append(text)
                        except Exception as page_exc:
                            logger.warning(
                                "OCR failed for page in batch %d-%d: %s",
                                batch_start,
                                batch_end,
                                page_exc,
                            )
                        finally:
                            img.close()
                    del images
                    gc.collect()
                except Exception as batch_exc:
                    logger.warning(
                        "OCR batch %d-%d failed: %s",
                        batch_start,
                        batch_end,
                        batch_exc,
                    )
                    continue

            if pages_text:
                return "\n\n".join(pages_text)
        except (ImportError, Exception) as exc:
            # Log but don't crash — OCR is best-effort
            import logging
            logging.getLogger(__name__).warning("OCR fallback failed: %s", exc)

        return ""

    # ------------------------------------------------------------------
    # DOCX
    # ------------------------------------------------------------------

    def _extract_docx(self, path: str) -> dict[str, Any]:
        doc = DocxDocument(path)
        paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]

        # Extract text from table cells (contract terms, payment schedules, etc.
        # are often in tables and are missed by doc.paragraphs alone)
        for table in doc.tables:
            for row in table.rows:
                for cell in row.cells:
                    if cell.text.strip():
                        paragraphs.append(cell.text.strip())

        # Extract headers (document title, article headings in header band)
        for section in doc.sections:
            header = section.header
            for para in header.paragraphs:
                if para.text.strip():
                    paragraphs.append(para.text.strip())

        page_count = max(1, len(paragraphs) // 40)  # Estimate
        return {"text": "\n\n".join(paragraphs), "page_count": page_count}

    # ------------------------------------------------------------------
    # DOC (legacy Word)
    # ------------------------------------------------------------------

    def _extract_doc(self, path: str) -> dict[str, Any]:
        # Try macOS textutil first
        try:
            result = subprocess.run(
                ["textutil", "-convert", "txt", "-stdout", path],
                capture_output=True,
                text=True,
                timeout=30,
            )
            if result.returncode == 0:
                text = result.stdout
                page_count = max(1, len(text.split("\n")) // 50)
                return {"text": text, "page_count": page_count}
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pass

        # Fallback: try reading as docx (some .doc files are actually docx)
        try:
            return self._extract_docx(path)
        except Exception:
            return {"text": "", "page_count": 0}

    # ------------------------------------------------------------------
    # XLSX / XLS
    # ------------------------------------------------------------------

    def _extract_xlsx(self, path: str) -> dict[str, Any]:
        from openpyxl import load_workbook

        wb = load_workbook(path, read_only=True, data_only=True)
        sheets_text: list[str] = []

        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            rows_text: list[str] = []
            for row in ws.iter_rows(values_only=True):
                cells = [str(c) if c is not None else "" for c in row]
                line = " | ".join(cells).strip()
                if line and line != " | ".join([""] * len(cells)):
                    rows_text.append(line)
            if rows_text:
                sheets_text.append(f"[Sheet: {sheet_name}]\n" + "\n".join(rows_text))

        wb.close()
        full_text = "\n\n".join(sheets_text)
        page_count = len(wb.sheetnames)
        return {"text": full_text, "page_count": page_count}

    # ------------------------------------------------------------------
    # PPTX / PPT
    # ------------------------------------------------------------------

    def _extract_pptx(self, path: str) -> dict[str, Any]:
        from pptx import Presentation

        prs = Presentation(path)
        slides_text: list[str] = []

        for i, slide in enumerate(prs.slides, 1):
            texts: list[str] = []
            for shape in slide.shapes:
                if shape.has_text_frame:
                    for paragraph in shape.text_frame.paragraphs:
                        text = paragraph.text.strip()
                        if text:
                            texts.append(text)
            if texts:
                slides_text.append(f"[Slide {i}]\n" + "\n".join(texts))

        page_count = len(prs.slides)
        return {"text": "\n\n".join(slides_text), "page_count": page_count}

    # ------------------------------------------------------------------
    # Plain text
    # ------------------------------------------------------------------

    def _extract_txt(self, path: str) -> dict[str, Any]:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            text = f.read()
        page_count = max(1, len(text.split("\n")) // 50)
        return {"text": text, "page_count": page_count}
