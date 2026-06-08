"""Phase 7.27 — Tests for the force-OCR extraction path.

Covers the new `force_ocr` mode on TesseractTextExtractor:
  - force_ocr=False routes to the digital text-layer fast path (no 'ocr_forced')
  - force_ocr=True routes to OCR and tags quality_flags with 'ocr_forced'
  - the OCR path renders at FORCE_OCR_DPI (300)

Real OCR is NOT run — pdf2image / pytesseract / PdfReader are mocked so the tests
are fast and have no PDF/binary dependencies.
"""

from __future__ import annotations

from unittest.mock import MagicMock

from app.services.tesseract_text_extractor import (
    TesseractTextExtractor,
    FORCE_OCR_DPI,
)


def test_text_layer_path_unchanged_no_ocr_forced_flag(mocker):
    """force_ocr=False uses the text-layer fast path; no 'ocr_forced' flag."""
    # Mock PdfReader so _extract_pdf reads a digital text layer without a real PDF.
    fake_page = MagicMock()
    fake_page.extract_text.return_value = "نص رقمي من طبقة النص"
    fake_reader = MagicMock()
    fake_reader.pages = [fake_page]
    mocker.patch(
        "app.services.tesseract_text_extractor.PdfReader",
        return_value=fake_reader,
    )
    # Guard: OCR must NOT be invoked on the fast path.
    conv = mocker.patch("pdf2image.convert_from_path")

    ext = TesseractTextExtractor()
    result = ext.extract("/tmp/whatever.pdf", "application/pdf", force_ocr=False)

    assert "نص رقمي" in result["text"]
    assert "ocr_forced" not in result["quality_flags"]
    conv.assert_not_called()


def _mock_one_image_per_call(mocker, n_pages, ocr_side_effect=None, ocr_return="نص"):
    """Wire pdfinfo_from_path → n_pages and convert_from_path → one image/call.

    Returns (convert_mock, ocr_mock).
    """
    mocker.patch("pdf2image.pdfinfo_from_path", return_value={"Pages": n_pages})
    # Each per-page convert_from_path call returns a fresh single-image list.
    conv = mocker.patch(
        "pdf2image.convert_from_path",
        side_effect=lambda *a, **k: [MagicMock()],
    )
    if ocr_side_effect is not None:
        ocr = mocker.patch("pytesseract.image_to_string", side_effect=ocr_side_effect)
    else:
        ocr = mocker.patch("pytesseract.image_to_string", return_value=ocr_return)
    return conv, ocr


def test_force_ocr_quality_flag_present(mocker):
    """Happy path still tags quality_flags with 'ocr_forced'."""
    _mock_one_image_per_call(mocker, 2, ocr_side_effect=["مادة 1", "مادة 2"])

    result = TesseractTextExtractor().extract(
        "/tmp/eta.pdf", "application/pdf", force_ocr=True
    )

    assert "ocr_forced" in result["quality_flags"]
    assert result["page_count"] == 2
    assert "مادة 1" in result["text"] and "مادة 2" in result["text"]


def test_force_ocr_renders_page_by_page(mocker):
    """Each page is rendered individually with first_page==last_page==page_num."""
    conv, ocr = _mock_one_image_per_call(
        mocker, 3, ocr_side_effect=["p1", "p2", "p3"]
    )

    TesseractTextExtractor().extract("/tmp/eta.pdf", "application/pdf", force_ocr=True)

    # 3 pages → 3 convert calls, each bounded to a single page.
    assert conv.call_count == 3
    for i, call in enumerate(conv.call_args_list, start=1):
        assert call.kwargs.get("first_page") == i
        assert call.kwargs.get("last_page") == i
        assert call.kwargs.get("dpi") == FORCE_OCR_DPI  # 300
    assert ocr.call_count == 3
    assert ocr.call_args_list[0].kwargs.get("lang") == "ara"


def test_force_ocr_dpi_is_300(mocker):
    """The OCR path renders at FORCE_OCR_DPI (300)."""
    conv, _ = _mock_one_image_per_call(mocker, 1)

    TesseractTextExtractor().extract("/tmp/eta.pdf", "application/pdf", force_ocr=True)

    assert FORCE_OCR_DPI == 300
    assert conv.call_args.kwargs.get("dpi") == 300


def test_force_ocr_continues_on_single_page_failure(mocker):
    """A single page's OCR failure is flagged and skipped, not fatal."""
    _mock_one_image_per_call(
        mocker,
        3,
        ocr_side_effect=["page one text", RuntimeError("ocr boom"), "page three text"],
    )

    result = TesseractTextExtractor().extract(
        "/tmp/eta.pdf", "application/pdf", force_ocr=True
    )

    # Document still succeeds; pages 1 and 3 present, page 2 is an empty gap.
    assert "page one text" in result["text"]
    assert "page three text" in result["text"]
    assert "ocr_forced" in result["quality_flags"]
    assert "ocr_page_2_failed" in result["quality_flags"]
    assert result["page_count"] == 3
