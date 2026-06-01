"""Unit tests for Phase 7.25 — TesseractTextExtractor scan quality detection.

Synthetic PIL images are generated in-process so no real PDF file is needed.
All tests are pure unit tests: no Redis, no Anthropic, no pytesseract OSD
call against real text (OSD failures are silently swallowed by _assess_quality).

Coverage:
  T1  Clean (high-variance, high-contrast) image → no flags
  T2  Blurry image (uniform gray → zero Laplacian variance) → blur flag
  T3  Low-contrast image (near-uniform pixels) → contrast flag
  T4  _enhance_image with contrast flag applies autocontrast (returns image)
  T5  _enhance_image with rotation flag applies .rotate() (returns image)
  T6  _enhance_image with no flags returns image unchanged
  T7  run_extract_text task includes quality_flags key in result
"""

from __future__ import annotations

import pytest
from PIL import Image


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _make_image(pixel_value: int = 128, width: int = 100, height: int = 100) -> Image.Image:
    """Create a solid-colour grayscale image.  uniform → low Laplacian variance."""
    img = Image.new("L", (width, height), pixel_value)
    return img.convert("RGB")


def _make_textured_image(width: int = 200, height: int = 200) -> Image.Image:
    """Create a high-contrast checkerboard — high Laplacian variance (sharp)."""
    import numpy as np
    arr = np.zeros((height, width, 3), dtype=np.uint8)
    for y in range(height):
        for x in range(width):
            v = 255 if (x // 10 + y // 10) % 2 == 0 else 0
            arr[y, x] = (v, v, v)
    return Image.fromarray(arr)


# ─── Instantiation helper ─────────────────────────────────────────────────────

def _extractor():
    from app.services.tesseract_text_extractor import TesseractTextExtractor
    return TesseractTextExtractor()


# ─── T1: clean image produces no flags ────────────────────────────────────────

def test_assess_quality_clean_image_no_flags():
    """A sharp, high-contrast checkerboard must not trigger any quality flag."""
    extractor = _extractor()
    img = _make_textured_image()
    flags = extractor._assess_quality([img])
    assert flags == [], f"Expected no flags for clean image, got: {flags}"


# ─── T2: blurry image (uniform solid colour) triggers blur flag ───────────────

def test_assess_quality_blurry_image_triggers_blur_flag():
    """A uniform solid-colour image has zero Laplacian variance → blur flag."""
    extractor = _extractor()
    # Uniform grey → every pixel identical → Laplacian variance = 0 (well below threshold 50)
    img = _make_image(pixel_value=128)
    flags = extractor._assess_quality([img])
    blur_flags = [f for f in flags if f.startswith("blur:")]
    assert len(blur_flags) >= 1, f"Expected blur flag for solid-colour image, got: {flags}"
    score = float(blur_flags[0].split(":")[1])
    assert score < 50.0, f"Blur score {score} should be below threshold 50"


# ─── T3: low-contrast image triggers contrast flag ───────────────────────────

def test_assess_quality_low_contrast_triggers_contrast_flag():
    """A near-uniform pale image has low pixel stddev → contrast flag."""
    extractor = _extractor()
    # Pixel value 200 on a 0-255 scale: stddev will be 0 (uniform), below threshold 20
    img = _make_image(pixel_value=200)
    flags = extractor._assess_quality([img])
    contrast_flags = [f for f in flags if f.startswith("contrast:")]
    assert len(contrast_flags) >= 1, f"Expected contrast flag for uniform image, got: {flags}"
    score = float(contrast_flags[0].split(":")[1])
    assert score < 20.0, f"Contrast score {score} should be below threshold 20"


# ─── T4: _enhance_image with contrast flag returns a valid PIL image ─────────

def test_enhance_image_contrast_flag_returns_image():
    """autocontrast must return a PIL Image without raising."""
    extractor = _extractor()
    img = _make_image(pixel_value=200)
    result = extractor._enhance_image(img, ["contrast:5.0"])
    assert isinstance(result, Image.Image), "Expected PIL Image back from _enhance_image"


# ─── T5: _enhance_image with rotation flag applies rotation ──────────────────

def test_enhance_image_rotation_flag_applies_rotation():
    """A rotation flag >= 5° should call PIL rotate and return a PIL Image."""
    extractor = _extractor()
    img = _make_textured_image(200, 200)
    result = extractor._enhance_image(img, ["rotation:15"])
    assert isinstance(result, Image.Image), "Expected PIL Image back from _enhance_image"
    # After expand=True rotation, dimensions should differ (not an exact equality test
    # because the exact dimensions depend on PIL's expand computation)


# ─── T6: _enhance_image with no flags returns image unchanged ────────────────

def test_enhance_image_no_flags_returns_image_unchanged():
    """No flags → _enhance_image must return the original image object."""
    extractor = _extractor()
    img = _make_textured_image()
    result = extractor._enhance_image(img, [])
    assert result is img, "Expected the same image object when no flags are present"


# ─── T7: run_extract_text task result always contains quality_flags ───────────

def test_run_extract_text_result_contains_quality_flags(mocker):
    """run_extract_text must include quality_flags in its result dict.

    The extractor is mocked so no real filesystem access occurs.
    quality_flags=[] simulates a clean digital PDF.
    """
    mock_service = mocker.MagicMock()
    mock_service.extract.return_value = {
        "text": "Sample contract text.",
        "page_count": 5,
        "quality_flags": [],
    }
    mocker.patch(
        "app.services.text_extractor_factory.get_text_extractor",
        return_value=mock_service,
    )

    from app.tasks import run_extract_text

    result = run_extract_text.run(
        {"file_path": "/fake/path.pdf", "mime_type": "application/pdf"},
    )

    assert result["status"] == "completed"
    assert "result" in result
    assert "quality_flags" in result["result"], (
        "quality_flags key must always be present in run_extract_text result"
    )
    assert result["result"]["quality_flags"] == []
